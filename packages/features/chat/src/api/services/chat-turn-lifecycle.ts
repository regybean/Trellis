import type {
  EntitlementsProvider,
  SubscriptionTier,
} from '@acme/entitlements';
import { logger } from '@acme/logger';
import { redis } from '@acme/redis';

import { chatConfig } from '../../config';
import { appEnv } from '../../env';
import {
  chatAbortKey,
  chatInflightKey,
  chatRefundedKey,
  chatStreamKey,
} from '../chat-keys';
import { createConversation, persistUserMessage } from './chat-memory';
import { enqueueGenerationTurn } from './chat-queue';

// Turn-lifecycle tunables are config-as-code (ADR 0026).
const config = chatConfig({ appEnv, isServer: true });

// The Turn lifecycle — the one home for a durable Turn's control plane, expressed
// as terminal-typed *transitions* rather than a bag of Redis verbs. A Turn moves
// through: `beginTurn` (acquire the In-flight lock, discard a stale Stream, run
// the ordered begin steps, unwind the lock on any failure) → `settleTurn(kind)`
// on a worker terminal (`done` | `cancelled` | `error`) → or `abortTurn` /
// `reconcileTurn` for the stop and orphan-recovery paths. Liveness is read once
// here (`readInflightTurn` for "which Turn is live", `isTurnAborted` for "has
// this Turn been told to stop"), so the router, the Generation worker, and the
// Stream reader no longer read the lock/abort keys directly. Keeping the lock
// acquire/release, the stale/terminal/orphan teardowns, and the idempotent refund
// behind this interface is what makes "the lock is only released by its own Turn",
// "a rejected send never leaks a held lock", and "the refund can never
// double-charge" true by construction rather than by every call site remembering
// the protocol. "By construction" is meant literally for the lock: the release is
// a single server-side compare-and-delete, so no read-then-act window exists for a
// re-acquiring Turn to slip into.

// The TTLs are config-as-code (ADR 0026). The In-flight lock's TTL
// (`config.INFLIGHT_LOCK_TTL`) doubles as the crash-recovery bound: the worker
// does NOT renew it (there is no heartbeat), so a worker that dies mid-Turn leaves
// the lock to self-expire, after which the next `beginTurn` can re-acquire. Until
// then a wedged Conversation is recovered by `reconcileTurn` (client-driven refund
// + teardown when a reader closes with no terminal). The abort signal
// (`config.ABORT_SIGNAL_TTL`) shares the value so a never-observed stop cannot
// linger past its Turn. After a terminal the Stream is shortened to a brief safety
// window (`config.STREAM_POST_TERMINAL_TTL`) and then proactively deleted — that
// TTL is only a net for a failed delete.

// The three worker terminals. `settleTurn` takes one so the caller names the
// terminal it emitted rather than remembering which teardown verb to call; the
// teardown is uniform across the three (all shorten the Stream — see below).
export type TurnTerminalKind = 'done' | 'cancelled' | 'error';

// A durable Turn's identity: the Conversation it runs in plus its own `turnId`.
// Bundled so the two same-typed ids travel as one named handle through the
// transitions below — the Data Clump that two adjacent `string` params invited,
// which also removes the positional-swap hazard between them.
export interface TurnRef {
  conversationId: string;
  turnId: string;
}

// Steps `chat.send` still authors but `beginTurn` orders and guards. `consume` is
// the credit gate + consume closure: it stays inline in `chat.send` (ADR 0006
// amendment + chat CONTEXT) so a rejected send consumes nothing, and `beginTurn`
// runs it at the one correct point in the ordering — after ownership + lock and
// the user-Message persist, before enqueue.
export interface BeginTurnInput extends TurnRef {
  userId: string;
  tier: SubscriptionTier;
  query: string;
  conversationExists: boolean;
  consume: () => Promise<void>;
}

// Acquire the one-in-flight-per-Conversation lock, valued by `turnId`. Returns
// false when a Turn is already in flight (a second tab, or a live worker).
async function acquireInflightLock({ conversationId, turnId }: TurnRef) {
  const acquired = await redis.set(chatInflightKey(conversationId), turnId, {
    NX: true,
    EX: config.INFLIGHT_LOCK_TTL,
  });
  return acquired !== null;
}

// Release the lock only if it still points to this Turn, as ONE server-side
// command (`compareAndDelete`). The check and the delete cannot be two round
// trips: a crashed worker's lock self-expires (there is no heartbeat) and a newer
// Turn may acquire it in between, so a `GET`-then-`DEL` pair would delete the NEW
// Turn's lock — silently admitting two in-flight Turns for one Conversation, the
// invariant this module exists to hold. Returns whether this Turn's lock was the
// one released (false ⇒ it had already lapsed and moved on).
async function releaseInflightLock({ conversationId, turnId }: TurnRef) {
  return redis.compareAndDelete(chatInflightKey(conversationId), turnId);
}

// Next-Turn cleanup. The Stream is Conversation-keyed and survives a terminal for
// a brief TTL (so late reconnects still see it), so a fresh Turn would tail from
// the head and re-read the PRIOR Turn's deltas + terminal — replaying the last
// response and colliding on its messageId. `beginTurn` runs this after it wins the
// lock (winner path only — an `alreadyInflight` caller must NOT delete a live
// stream) and before enqueue, so the worker writes onto a clean Stream. Safe under
// the lock: no concurrent worker is writing this key. (See #43.)
async function discardStaleStream(conversationId: string) {
  await redis.del(chatStreamKey(conversationId));
}

// The liveness query: the `turnId` currently in flight for a Conversation, or null
// when idle. The single read of the In-flight lock — the router (`stop`,
// `inflightTurn`) and the Stream reader both obtain liveness through it rather than
// reading the lock key directly. The lock value remains the `turnId`.
export async function readInflightTurn(conversationId: string) {
  return redis.get(chatInflightKey(conversationId));
}

// The abort-signal read, paired with `abortTurn`'s write. The Generation worker
// asks this each stream iteration — "has this Turn been told to stop?" — instead
// of reading the abort key directly.
export async function isTurnAborted({ conversationId, turnId }: TurnRef) {
  return (await redis.get(chatAbortKey(conversationId))) === turnId;
}

// Idempotent credit refund. The SET NX guard (`chat:refunded:{turnId}`) is the
// chat control plane's own concern and stays local here; it admits exactly one
// refund per Turn, so the worker error path and `reconcileTurn` can race without
// ever double-refunding. The actual credit-back crosses the injected
// `EntitlementsProvider` seam — `refund` is passed in (the worker supplies its
// injected provider's; `reconcileTurn` forwards the router's
// `ctx.entitlements.refund`), so this module never imports a billing
// implementation. `CREDITS_PER_TURN` has one origin in config (not re-exported
// here). Returns whether this call performed the refund (false ⇒ already refunded).
//
// The guard and the credit-back are two writes, not one commit, and CANNOT be
// fused from here: the credit-back lands on the provider's own storage, which this
// module deliberately cannot name (that seam is what keeps `@acme/chat` free of
// `@acme/subscriptions`). So a crash in between leaves the Turn marked refunded
// with the credit not returned. The order is the deliberate bias: guard-first
// loses at most one credit, refund-first would hand out a free one on every
// crash, and the guard is permanent (no TTL) so a replayed `reconcileTurn` can
// never mint credits. Closing the window entirely needs the credit-back to carry
// chat's idempotency key across the seam — see #198.
export async function refundTurnCredits(
  refund: EntitlementsProvider['refund'],
  userId: string,
  tier: SubscriptionTier,
  turnId: string,
) {
  const acquired = await redis.set(chatRefundedKey(turnId), '1', { NX: true });
  if (acquired === null) return false;
  await refund(userId, tier, config.CREDITS_PER_TURN);
  return true;
}

// Begin a Turn. Owns the begin-step ordering that used to be inlined in
// `chat.send`: acquire the In-flight lock (SET NX EX, value = turnId) FIRST so a
// duplicate tab returns `alreadyInflight` without persisting a Message, enqueuing a
// job, or spending a credit; then discard the stale Stream, ensure the
// Conversation, persist the user Message, run the caller's credit gate + consume,
// and enqueue the Generation worker job. Any failure after the lock was won
// releases it internally (folding in the manual unwind `chat.send` used to do on
// the credit-exhaustion and catch-all branches), so a rejected `chat.send` can
// never leak a held lock; the original error propagates for the caller to map.
// Reports winner (`accepted`) vs loser (`alreadyInflight`).
export async function beginTurn(input: BeginTurnInput) {
  const { conversationId, turnId, userId, tier, query } = input;
  const ref: TurnRef = { conversationId, turnId };

  const acquired = await acquireInflightLock(ref);
  if (!acquired) return { status: 'alreadyInflight' as const };

  try {
    await discardStaleStream(conversationId);
    if (!input.conversationExists) {
      await createConversation(conversationId, userId);
    }
    await persistUserMessage(conversationId, userId, query);
    await input.consume();
    await enqueueGenerationTurn({
      conversationId,
      turnId,
      userId,
      tier,
      query,
    });
    return { status: 'accepted' as const };
  } catch (error) {
    await releaseInflightLock(ref);
    throw error;
  }
}

// Settle a Turn on a worker terminal (was `finalizeTurn`). All three kinds share
// this teardown: the Stream is NOT deleted, it is shortened to the post-terminal
// window so a client that reconnects *after* generation finished still reads the
// terminal (done / cancelled / error) instead of an empty stream, then it
// self-expires. Drops the abort signal and releases the lock. (Deleting on
// terminal would race a reconnecting reader and lose the terminal; hard-delete of
// an orphan's Stream is `reconcileTurn`, and the stale-stream discard that stops
// the *next* Turn re-reading this one is inside `beginTurn` — see #43.)
export async function settleTurn(kind: TurnTerminalKind, ref: TurnRef) {
  const { conversationId, turnId } = ref;
  logger.debug({ conversationId, turnId, kind }, 'chat: turn settled');
  await redis.expire(
    chatStreamKey(conversationId),
    config.STREAM_POST_TERMINAL_TTL,
  );
  await redis.del(chatAbortKey(conversationId));
  await releaseInflightLock(ref);
}

// Publish the abort signal for a Turn (was `publishAbort`). The worker polls
// `isTurnAborted` on each stream iteration and halts when it matches its own
// `turnId`.
export async function abortTurn({ conversationId, turnId }: TurnRef) {
  await redis.set(chatAbortKey(conversationId), turnId, {
    EX: config.ABORT_SIGNAL_TTL,
  });
}

// Reconcile an orphaned Turn (was `refundTurnCredits` + `cleanupTurn`, in that
// order). Called via `chat.reconcileTurn` when a reader closes with no terminal: a
// crashed worker left a Stream with no terminal and a stale lock. Refund the
// Turn's credit (guarded, so the worker error path and this can't double-refund),
// then hard-delete the Stream (no reader is owed a terminal), drop the abort
// signal, and release the lock. Idempotent. Returns whether this call performed
// the refund so the client can toast "generation failed, refunded".
export async function reconcileTurn(
  refund: EntitlementsProvider['refund'],
  userId: string,
  tier: SubscriptionTier,
  ref: TurnRef,
) {
  const refunded = await refundTurnCredits(refund, userId, tier, ref.turnId);
  await redis.del(chatStreamKey(ref.conversationId));
  await redis.del(chatAbortKey(ref.conversationId));
  await releaseInflightLock(ref);
  return { refunded };
}
