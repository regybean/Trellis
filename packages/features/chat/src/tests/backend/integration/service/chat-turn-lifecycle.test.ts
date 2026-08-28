import { describe, expect, it } from 'vitest';

import type {
  EntitlementsProvider,
  SubscriptionTier,
} from '@acme/entitlements';
import { redis } from '@acme/redis';

import type { TurnTerminalKind } from '../../../../api/services/chat-turn-lifecycle';
import {
  chatAbortKey,
  chatInflightKey,
  chatRefundedKey,
  chatStreamKey,
} from '../../../../api/chat-keys';
import {
  abortTurn,
  beginTurn,
  isTurnAborted,
  readInflightTurn,
  reconcileTurn,
  refundTurnCredits,
  settleTurn,
} from '../../../../api/services/chat-turn-lifecycle';
import { env } from '../../../../env';
import {
  createTestChat,
  createTestSessionId,
  createTestUserId,
} from '../../utils/fixtures';

/**
 * The Turn control plane, driven directly against a real Redis (this suite's
 * isolated logical DB). The router tests cover what `chat.send` /
 * `chat.reconcileTurn` expose to a client; this suite covers the transitions
 * themselves — specifically the protocol properties a caller cannot reach through
 * a procedure:
 *
 * - the failure-path lock unwind inside `beginTurn`, including the case the
 *   owner-checked release exists for (the lock lapsed and a NEWER Turn owns it);
 * - `settleTurn` (Stream shortened to the post-terminal window, so a late
 *   reconnect still reads the terminal) vs `reconcileTurn` (Stream hard-deleted —
 *   no reader is owed a terminal from a crashed worker);
 * - the refund idempotency guard under a concurrent race.
 *
 * The credit-back crosses the injected `EntitlementsProvider` seam, so refunds are
 * asserted through a recording `refund` passed in exactly as the worker and the
 * router pass theirs — never a `vi.mock` of a seam chat owns.
 */

const { CREDITS_PER_TURN, STREAM_POST_TERMINAL_TTL } = env;

interface RefundCall {
  userId: string;
  tier: SubscriptionTier;
  amount: number;
}

function makeRecordingRefund() {
  const calls: RefundCall[] = [];
  const refund: EntitlementsProvider['refund'] = (userId, tier, amount) => {
    calls.push({ userId, tier, amount });
    return Promise.resolve();
  };
  return { refund, calls };
}

// A Turn on an existing Conversation, so a begin-step failure is the credit
// consume (the caller's closure) rather than an absent thread.
async function seedConversation() {
  const userId = createTestUserId();
  const conversationId = createTestSessionId();
  await createTestChat({ userId, sessionId: conversationId });
  return { userId, conversationId, turnId: crypto.randomUUID() };
}

function beginInput(
  seed: Awaited<ReturnType<typeof seedConversation>>,
  consume: () => Promise<void>,
) {
  return {
    conversationId: seed.conversationId,
    turnId: seed.turnId,
    userId: seed.userId,
    tier: 'Basic' as SubscriptionTier,
    query: 'Hello there',
    conversationExists: true,
    consume,
  };
}

const noopConsume = () => Promise.resolve();

describe('beginTurn', () => {
  it('acquires the In-flight lock valued by turnId', async () => {
    const seed = await seedConversation();
    expect(await readInflightTurn(seed.conversationId)).toBeNull();

    const result = await beginTurn(beginInput(seed, noopConsume));

    expect(result).toEqual({ status: 'accepted' });
    expect(await readInflightTurn(seed.conversationId)).toBe(seed.turnId);
  });

  it('reports alreadyInflight and leaves the live Turn holding the lock', async () => {
    const seed = await seedConversation();
    const liveTurnId = crypto.randomUUID();
    await redis.set(chatInflightKey(seed.conversationId), liveTurnId, {
      NX: true,
    });

    const result = await beginTurn(beginInput(seed, noopConsume));

    expect(result).toEqual({ status: 'alreadyInflight' });
    expect(await readInflightTurn(seed.conversationId)).toBe(liveTurnId);
  });

  it('unwinds the lock when a begin step fails, and rethrows', async () => {
    // A rejected send must leave nothing held: the credit gate throwing (the
    // exhausted-credits branch `chat.send` maps to TOO_MANY_REQUESTS) is the
    // realistic failure after the lock is won.
    const seed = await seedConversation();
    const failure = new Error('credits exhausted');

    await expect(
      beginTurn(beginInput(seed, () => Promise.reject(failure))),
    ).rejects.toThrow(failure);

    expect(await readInflightTurn(seed.conversationId)).toBeNull();
  });

  it('does not unwind a lock a newer Turn acquired while this one was failing', async () => {
    // The invariant the owner-checked release protects: a crashed worker's lock
    // self-expires (no heartbeat), so between "my begin started failing" and "my
    // unwind runs" the lock can lapse and a NEXT Turn can win it — that Turn's
    // lock must survive my unwind, or one Conversation has two in-flight Turns.
    // The lapse + re-acquire is driven from inside the failing step so the
    // ordering is deterministic rather than timing-dependent. The tighter
    // sub-round-trip window (a re-acquire landing *between* a `GET` and a `DEL`)
    // is closed by construction — the release is one `EVAL`, so there is no
    // window to interleave into — and is not observable from a caller.
    const seed = await seedConversation();
    const nextTurnId = crypto.randomUUID();

    await expect(
      beginTurn(
        beginInput(seed, async () => {
          await redis.del(chatInflightKey(seed.conversationId));
          await redis.set(chatInflightKey(seed.conversationId), nextTurnId, {
            NX: true,
          });
          throw new Error('credits exhausted');
        }),
      ),
    ).rejects.toThrow('credits exhausted');

    expect(await readInflightTurn(seed.conversationId)).toBe(nextTurnId);
  });
});

describe('settleTurn', () => {
  const kinds: TurnTerminalKind[] = ['done', 'cancelled', 'error'];

  it.each(kinds)(
    'shortens the Stream, drops the abort signal and releases the lock on %s',
    async (kind) => {
      const { conversationId, turnId } = await seedConversation();
      const streamKey = chatStreamKey(conversationId);
      await redis.xAdd(streamKey, '*', { chunk: 'token' });
      await redis.set(chatInflightKey(conversationId), turnId, { NX: true });
      await abortTurn({ conversationId, turnId });

      await settleTurn(kind, { conversationId, turnId });

      // The Stream SURVIVES on the short post-terminal window — a client that
      // reconnects after generation finished still reads the terminal.
      expect(await redis.xLen(streamKey)).toBe(1);
      const ttl = await redis.ttl(streamKey);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(STREAM_POST_TERMINAL_TTL);

      expect(await redis.get(chatAbortKey(conversationId))).toBeNull();
      expect(await readInflightTurn(conversationId)).toBeNull();
    },
  );

  it('leaves a lock already re-acquired by a newer Turn held', async () => {
    const { conversationId, turnId } = await seedConversation();
    const nextTurnId = crypto.randomUUID();
    await redis.set(chatInflightKey(conversationId), nextTurnId, { NX: true });

    await settleTurn('done', { conversationId, turnId });

    expect(await readInflightTurn(conversationId)).toBe(nextTurnId);
  });
});

describe('reconcileTurn', () => {
  it('refunds, hard-deletes the Stream, drops the abort signal and releases the lock', async () => {
    const { userId, conversationId, turnId } = await seedConversation();
    const streamKey = chatStreamKey(conversationId);
    await redis.xAdd(streamKey, '*', { chunk: 'orphaned partial' });
    await redis.set(chatInflightKey(conversationId), turnId, { NX: true });
    await abortTurn({ conversationId, turnId });
    const { refund, calls } = makeRecordingRefund();

    const result = await reconcileTurn(refund, userId, 'Basic', {
      conversationId,
      turnId,
    });

    expect(result).toEqual({ refunded: true });
    expect(calls).toEqual([
      { userId, tier: 'Basic', amount: CREDITS_PER_TURN },
    ]);
    // Unlike a terminal settle, the orphan's Stream is GONE — no reader is owed
    // a terminal a crashed worker never wrote.
    expect(await redis.exists(streamKey)).toBe(0);
    expect(await redis.get(chatAbortKey(conversationId))).toBeNull();
    expect(await readInflightTurn(conversationId)).toBeNull();
  });

  it('is idempotent — a second reconcile refunds nothing', async () => {
    const { userId, conversationId, turnId } = await seedConversation();
    const { refund, calls } = makeRecordingRefund();
    const ref = { conversationId, turnId };

    expect(await reconcileTurn(refund, userId, 'Basic', ref)).toEqual({
      refunded: true,
    });
    expect(await reconcileTurn(refund, userId, 'Basic', ref)).toEqual({
      refunded: false,
    });

    expect(calls).toHaveLength(1);
    expect(await redis.get(chatRefundedKey(turnId))).toBe('1');
  });

  it('admits exactly one refund when the worker error path and reconcile race', async () => {
    // The two refund paths (the Generation worker on `error`,
    // `chat.reconcileTurn` on orphan) can fire concurrently for one Turn. The
    // `SET NX` guard admits exactly one, so the user is never credited twice.
    const { userId, conversationId, turnId } = await seedConversation();
    const { refund, calls } = makeRecordingRefund();

    const results = await Promise.all([
      refundTurnCredits(refund, userId, 'Basic', turnId),
      reconcileTurn(refund, userId, 'Basic', { conversationId, turnId }).then(
        (r) => r.refunded,
      ),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });
});

describe('abortTurn / isTurnAborted', () => {
  it('reports aborted only for the Turn the stop named', async () => {
    const { conversationId, turnId } = await seedConversation();
    expect(await isTurnAborted({ conversationId, turnId })).toBe(false);

    await abortTurn({ conversationId, turnId });

    expect(await isTurnAborted({ conversationId, turnId })).toBe(true);
    // A stale signal from a previous Turn must not halt this one.
    expect(
      await isTurnAborted({ conversationId, turnId: crypto.randomUUID() }),
    ).toBe(false);
  });
});
