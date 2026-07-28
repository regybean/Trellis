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
// the protocol.

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

// Steps `chat.send` still authors but `beginTurn` orders and guards. `consume` is
// the credit gate + consume closure: it stays inline in `chat.send` (ADR 0006
// amendment + chat CONTEXT) so a rejected send consumes nothing, and `beginTurn`
// runs it at the one correct point in the ordering — after ownership + lock and
// the user-Message persist, before enqueue.
export interface BeginTurnInput {
  conversationId: string;
  turnId: string;
  userId: string;
  tier: SubscriptionTier;
  query: string;
  conversationExists: boolean;
  consume: () => Promise<void>;
}

// Acquire the one-in-flight-per-Conversation lock, valued by `turnId`. Returns
// false when a Turn is already in flight (a second tab, or a live worker).
async function acquireInflightLock(conversationId: string, turnId: string) {
  const acquired = await redis.set(chatInflightKey(conversationId), turnId, {
    NX: true,
    EX: config.INFLIGHT_LOCK_TTL,
  });
  return acquired !== null;
}

// Release the lock only if it still points to this Turn — a crashed worker may
// have let the TTL lapse and a newer Turn may already own it.
async function releaseInflightLock(conversationId: string, turnId: string) {
  const lockValue = await redis.get(chatInflightKey(conversationId));
  if (lockValue === turnId) await redis.del(chatInflightKey(conversationId));
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
export async function isTurnAborted(conversationId: string, turnId: string) {
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

  const acquired = await acquireInflightLock(conversationId, turnId);
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
    await releaseInflightLock(conversationId, turnId);
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
export async function settleTurn(
  kind: TurnTerminalKind,
  conversationId: string,
  turnId: string,
) {
  logger.debug({ conversationId, turnId, kind }, 'chat: turn settled');
  await redis.expire(
    chatStreamKey(conversationId),
    config.STREAM_POST_TERMINAL_TTL,
  );
  await redis.del(chatAbortKey(conversationId));
  await releaseInflightLock(conversationId, turnId);
}

// Publish the abort signal for a Turn (was `publishAbort`). The worker polls
// `isTurnAborted` on each stream iteration and halts when it matches its own
// `turnId`.
export async function abortTurn(conversationId: string, turnId: string) {
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
  conversationId: string,
  turnId: string,
) {
  const refunded = await refundTurnCredits(refund, userId, tier, turnId);
  await redis.del(chatStreamKey(conversationId));
  await redis.del(chatAbortKey(conversationId));
  await releaseInflightLock(conversationId, turnId);
  return { refunded };
}
