/**
 * Feedback Router Tests
 *
 * Testing philosophy:
 * - Exercise the ADR-0002 ownership seam end-to-end against a real DB
 * - "zero, one, many" coverage for reads
 * - Mock only env/external services (see setup.ts); DB/Redis are real
 *
 * The `submit` mutation is the worked example: a Drizzle-owned row that
 * annotates Mastra-owned ids, with integrity enforced in code.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import type { TestContextOptions } from '../utils/test-context';
import { appRouter } from '../../../api/root';
import {
  createTestSessionId,
  createTestThread,
  createTestThreadWithMessage,
  createTestUserId,
} from '../utils/fixtures';
import { cleanupTestData, createTestContext } from '../utils/test-context';

function createCaller(opts: TestContextOptions) {
  const ctx = createTestContext(opts);
  return appRouter.createCaller(ctx);
}

const baseCredits = {
  remaining: 100,
  limit: 100,
  resetAt: Date.now() + 86_400_000,
};

function callerFor(userId: string) {
  return createCaller({
    userId,
    role: 'user',
    tier: 'Basic',
    credits: baseCredits,
  });
}

describe('feedbackRouter', () => {
  beforeEach(async () => {
    await cleanupTestData();
  });

  describe('submit', () => {
    it('rejects feedback on a thread owned by another user (FORBIDDEN)', async () => {
      const owner = createTestUserId('owner');
      const { sessionId, messageId } = await createTestThreadWithMessage({
        userId: owner,
      });

      const intruder = callerFor(createTestUserId('intruder'));

      await expect(
        intruder.feedback.submit({
          messageId,
          threadId: sessionId,
          rating: 'up',
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('rejects feedback on a non-existent thread (NOT_FOUND)', async () => {
      const caller = callerFor(createTestUserId());

      await expect(
        caller.feedback.submit({
          messageId: createTestSessionId(),
          threadId: createTestSessionId(),
          rating: 'up',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('rejects feedback for a message not in the thread (NOT_FOUND)', async () => {
      const userId = createTestUserId();
      const { sessionId } = await createTestThread({ userId });
      const caller = callerFor(userId);

      await expect(
        caller.feedback.submit({
          messageId: createTestSessionId(),
          threadId: sessionId,
          rating: 'up',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('creates feedback for an owned message', async () => {
      const userId = createTestUserId();
      const { sessionId, messageId } = await createTestThreadWithMessage({
        userId,
      });
      const caller = callerFor(userId);

      const saved = await caller.feedback.submit({
        messageId,
        threadId: sessionId,
        rating: 'up',
        comment: 'helpful',
      });

      expect(saved).toMatchObject({
        messageId,
        threadId: sessionId,
        userId,
        rating: 'up',
        comment: 'helpful',
      });
    });

    it('updates existing feedback on a second submit (upsert)', async () => {
      const userId = createTestUserId();
      const { sessionId, messageId } = await createTestThreadWithMessage({
        userId,
      });
      const caller = callerFor(userId);

      await caller.feedback.submit({
        messageId,
        threadId: sessionId,
        rating: 'up',
      });
      const updated = await caller.feedback.submit({
        messageId,
        threadId: sessionId,
        rating: 'down',
      });

      expect(updated.rating).toBe('down');

      // Still a single row for (user, message).
      const current = await caller.feedback.forMessage({ messageId });
      expect(current?.rating).toBe('down');
    });
  });

  describe('forMessage', () => {
    it('returns null when the caller has no feedback (zero)', async () => {
      const userId = createTestUserId();
      const { messageId } = await createTestThreadWithMessage({ userId });
      const caller = callerFor(userId);

      await expect(
        caller.feedback.forMessage({ messageId }),
      ).resolves.toBeNull();
    });

    it('returns the caller-owned feedback (one)', async () => {
      const userId = createTestUserId();
      const { sessionId, messageId } = await createTestThreadWithMessage({
        userId,
      });
      const caller = callerFor(userId);

      await caller.feedback.submit({
        messageId,
        threadId: sessionId,
        rating: 'down',
      });

      const row = await caller.feedback.forMessage({ messageId });
      expect(row).toMatchObject({ messageId, userId, rating: 'down' });
    });

    it("does not return another user's feedback", async () => {
      const owner = createTestUserId('owner');
      const { sessionId, messageId } = await createTestThreadWithMessage({
        userId: owner,
      });
      await callerFor(owner).feedback.submit({
        messageId,
        threadId: sessionId,
        rating: 'up',
      });

      // A different caller sees no feedback for the same message.
      const other = callerFor(createTestUserId('other'));
      await expect(
        other.feedback.forMessage({ messageId }),
      ).resolves.toBeNull();
    });
  });

  describe('remove', () => {
    it('clears the caller feedback (toggle off)', async () => {
      const userId = createTestUserId();
      const { sessionId, messageId } = await createTestThreadWithMessage({
        userId,
      });
      const caller = callerFor(userId);

      await caller.feedback.submit({
        messageId,
        threadId: sessionId,
        rating: 'up',
      });
      const result = await caller.feedback.remove({ messageId });
      expect(result).toEqual({ messageId });

      await expect(
        caller.feedback.forMessage({ messageId }),
      ).resolves.toBeNull();
    });

    it('is a no-op when there is no feedback', async () => {
      const userId = createTestUserId();
      const { messageId } = await createTestThreadWithMessage({ userId });
      const caller = callerFor(userId);

      await expect(caller.feedback.remove({ messageId })).resolves.toEqual({
        messageId,
      });
    });
  });
});
