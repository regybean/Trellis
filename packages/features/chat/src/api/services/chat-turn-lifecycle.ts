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

// Tear down a Turn's Redis footprint: shorten then delete the Stream, drop the
// abort signal, and release the In-flight lock iff it still points to this Turn.
// Runs on every terminal (worker `finally`) and on orphan cleanup
// (chat.reconcileTurn); idempotent so both paths are safe.
export async function cleanupTurn(conversationId: string, turnId: string) {
  const streamKey = chatStreamKey(conversationId);
  // Shorten before the proactive delete so a failed `del` still expires.
  await redis.expire(streamKey, STREAM_POST_TERMINAL_TTL);
  await redis.del(streamKey);
  await redis.del(chatAbortKey(conversationId));
  await releaseInflightLock(conversationId, turnId);
}
