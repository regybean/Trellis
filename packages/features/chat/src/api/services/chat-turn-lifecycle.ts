import type { SubscriptionTier } from '@acme/subscriptions';
import { redis } from '@acme/redis';
import { credits } from '@acme/subscriptions';

import {
  chatAbortKey,
  chatInflightKey,
  chatRefundedKey,
  chatStreamKey,
} from '../chat-keys';

// The Redis control plane for a Turn's lifecycle — the one home for the
// In-flight lock, the abort signal, the idempotent credit refund, and the
// teardown. Both sides of the producer/reader split write through here:
// `chat.send`/`chat.stop`/`chat.reconcileTurn` (the request side) and the
// generation worker (the request-less side). Keeping the mutations in one
// module is what makes "the refund can never double-charge" and "the lock is
// only released by its own Turn" true by construction rather than by every
// call site remembering the guard.

// Credits charged per Turn. The consume (in chat.send) and every refund path
// (worker error terminal, chat.reconcileTurn) read this one constant so a
// refund can never differ from the charge.
export const CREDITS_PER_TURN = 1;

// The In-flight lock doubles as crash detection: a worker renews it as a
// heartbeat, so a lock whose TTL lapses without a terminal signals a dead
// worker and the next send may re-acquire. The abort signal shares the TTL so a
// never-observed stop cannot linger past the Turn it referenced.
const INFLIGHT_LOCK_TTL = 600;
const ABORT_SIGNAL_TTL = 600;

// After a terminal the Stream is shortened to a brief safety window and then
// proactively deleted — the TTL is only a net for a failed delete.
const STREAM_POST_TERMINAL_TTL = 60;

// Acquire the one-in-flight-per-Conversation lock, valued by `turnId`. Returns
// false when a Turn is already in flight (a second tab, or a live worker) — the
// caller re-attaches to the existing stream instead of starting a new Turn.
export async function acquireInflightLock(
  conversationId: string,
  turnId: string,
) {
  const acquired = await redis.set(chatInflightKey(conversationId), turnId, {
    NX: true,
    EX: INFLIGHT_LOCK_TTL,
  });
  return acquired !== null;
}

// The `turnId` currently in flight for a Conversation, or null when idle.
export async function readInflightTurn(conversationId: string) {
  return redis.get(chatInflightKey(conversationId));
}

// Release the lock only if it still points to this Turn — a crashed worker may
// have let the TTL lapse and a newer Turn may already own it.
export async function releaseInflightLock(
  conversationId: string,
  turnId: string,
) {
  const lockValue = await redis.get(chatInflightKey(conversationId));
  if (lockValue === turnId) await redis.del(chatInflightKey(conversationId));
}

// Publish the abort signal for a Turn. The worker polls `chatAbortKey` on each
// stream iteration and halts when the value matches its own `turnId`.
export async function publishAbort(conversationId: string, turnId: string) {
  await redis.set(chatAbortKey(conversationId), turnId, {
    EX: ABORT_SIGNAL_TTL,
  });
}

// Idempotent credit refund. The SET NX guard (`chat:refunded:{turnId}`) admits
// exactly one refund per Turn, so the worker error path and chat.reconcileTurn
// can race without ever double-refunding. Returns whether this call performed
// the refund (false ⇒ already refunded).
export async function refundTurnCredits(
  userId: string,
  tier: SubscriptionTier,
  turnId: string,
) {
  const acquired = await redis.set(chatRefundedKey(turnId), '1', { NX: true });
  if (acquired === null) return false;
  await credits.refund(userId, tier, CREDITS_PER_TURN);
  return true;
}

// Worker terminal path. The Stream is NOT deleted here: it is shortened to the
// post-terminal window so a client that reconnects *after* generation finished
// still reads the terminal (done / cancelled / error) instead of an empty
// stream, then it self-expires. Drops the abort signal and releases the lock.
// (Deleting on terminal would race a reconnecting reader and lose the terminal;
// the stale-stream cleanup that stops the *next* Turn re-reading this one is
// `discardStaleStream`, called by `chat.send` after it wins the lock — see #43.)
export async function finalizeTurn(conversationId: string, turnId: string) {
  await redis.expire(chatStreamKey(conversationId), STREAM_POST_TERMINAL_TTL);
  await redis.del(chatAbortKey(conversationId));
  await releaseInflightLock(conversationId, turnId);
}

// Next-Turn cleanup. The Stream is keyed by Conversation and survives a terminal
// for a brief TTL (so late reconnects still see it), so a fresh Turn would tail
// from the head and re-read the PRIOR Turn's deltas + terminal — replaying the
// last response and colliding on its messageId. `chat.send` calls this after it
// wins the In-flight lock (winner path only — an `alreadyInflight` caller must
// NOT delete a live stream) and before enqueue, so the worker writes onto a
// clean Stream. Safe under the lock: no concurrent worker is writing this key.
export async function discardStaleStream(conversationId: string) {
  await redis.del(chatStreamKey(conversationId));
}

// Orphan cleanup path (chat.reconcileTurn). A crashed worker left a Stream with
// no terminal and a stale lock; no reader is owed a terminal, so hard-delete the
// Stream, drop the abort signal, and release the lock. Idempotent.
export async function cleanupTurn(conversationId: string, turnId: string) {
  await redis.del(chatStreamKey(conversationId));
  await redis.del(chatAbortKey(conversationId));
  await releaseInflightLock(conversationId, turnId);
}
