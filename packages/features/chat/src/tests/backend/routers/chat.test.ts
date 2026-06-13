/**
 * Chat Router Tests
 *
 * Testing philosophy:
 * - Test auth/validation ONCE since all procedures use the same middleware
 * - Focus on BUSINESS LOGIC with real database scenarios
 * - Test with "zero, one, many" pattern for data
 * - Use real DB/Redis via testcontainers or docker-compose
 * - Mock only external services (LLM, Stripe, Otel)
 */

import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TestContextOptions } from '@acme/test-utils';

import { appRouter } from '../../../api/root';
import { chats } from '../../../api/schemas/chat-schema';
import { messages } from '../../../api/schemas/message-schema';
import { chatService } from '../../../api/services/chat-service';
import { db } from '../../../api/trpc';
import {
  createTestChat,
  createTestChatWithMessages,
  createTestSessionId,
  createTestUserId,
} from '../utils/fixtures';
import { cleanupTestData, createTestContext } from '../utils/test-context';

// Helper to create a tRPC caller with the given context options
function createCaller(opts: TestContextOptions) {
  const ctx = createTestContext(opts);
  return appRouter.createCaller(ctx);
}

describe('chatRouter', () => {
  beforeEach(async () => {
    await cleanupTestData();
  });

  // ==========================================================================
  // MIDDLEWARE TESTS (test once since all procedures share the same middleware)
  // ==========================================================================
  describe('middleware (tested once)', () => {
    describe('adminProcedure authorization', () => {
      it('rejects non-admin users', async () => {
        const caller = createCaller({
          userId: createTestUserId(),
          role: 'user',
          tier: 'Basic',
          credits: {
            remaining: 100,
            limit: 100,
            resetAt: Date.now() + 86_400_000,
          },
        });

        await expect(
          caller.chat.adminGet({
            sessionId: createTestSessionId(),
          }),
        ).rejects.toMatchObject({
          code: 'UNAUTHORIZED',
        });
      });

      it('allows admin users', async () => {
        const ownerUserId = createTestUserId('owner');
        const adminUserId = createTestUserId('admin');
        const chat = await createTestChat({ userId: ownerUserId });

        const caller = createCaller({
          userId: adminUserId,
          role: 'admin',
          tier: 'Basic',
          credits: {
            remaining: 100,
            limit: 100,
            resetAt: Date.now() + 86_400_000,
          },
        });

        const result = await caller.chat.adminGet({
          sessionId: chat.sessionId,
        });

        expect(result).toMatchObject({
          sessionId: chat.sessionId,
          userId: ownerUserId,
        });
      });
    });

    describe('rate limiting', () => {
      it('rejects when tokens exhausted', async () => {
        const caller = createCaller({
          userId: createTestUserId(),
          role: 'user',
          tier: 'Basic',
          credits: {
            remaining: 0,
            limit: 100,
            resetAt: Date.now() + 86_400_000,
          },
        });

        await expect(
          caller.chat.stream({
            query: 'test',
            sessionId: createTestSessionId(),
          }),
        ).rejects.toMatchObject({
          code: 'TOO_MANY_REQUESTS',
        });
      });
    });
  });

  // ==========================================================================
  // BUSINESS LOGIC: create
  // ==========================================================================
  describe('create', () => {
    it('creates a new chat session', async () => {
      const userId = createTestUserId();
      const sessionId = createTestSessionId();
      const caller = createCaller({
        userId,
        role: 'user',
        tier: 'Basic',
        credits: {
          remaining: 100,
          limit: 100,
          resetAt: Date.now() + 86_400_000,
        },
      });

      const result = await caller.chat.create({ sessionId });

      expect(result).toMatchObject({
        sessionId,
        userId,
      });

      // Verify persisted to database
      const dbChat = await db
        .select()
        .from(chats)
        .where(eq(chats.sessionId, sessionId));
      expect(dbChat).toHaveLength(1);
      expect(dbChat[0]).toMatchObject({ sessionId, userId });
    });

    it('returns existing chat if sessionId already exists (idempotent)', async () => {
      const userId = createTestUserId();
      const existingChat = await createTestChat({ userId });
      const caller = createCaller({
        userId,
        role: 'user',
        tier: 'Basic',
        credits: {
          remaining: 100,
          limit: 100,
          resetAt: Date.now() + 86_400_000,
        },
      });

      const result = await caller.chat.create({
        sessionId: existingChat.sessionId,
      });

      expect(result).toMatchObject({
        sessionId: existingChat.sessionId,
        userId,
      });

      // Verify no duplicate was created
      const dbChats = await db
        .select()
        .from(chats)
        .where(eq(chats.sessionId, existingChat.sessionId));
      expect(dbChats).toHaveLength(1);
    });
  });

  // ==========================================================================
  // BUSINESS LOGIC: get
  // ==========================================================================
  describe('get', () => {
    describe('ownership authorization', () => {
      it('rejects accessing chat owned by another user', async () => {
        const ownerUserId = createTestUserId('owner');
        const otherUserId = createTestUserId('other');
        const { chat } = await createTestChatWithMessages({
          userId: ownerUserId,
        });

        const caller = createCaller({
          userId: otherUserId,
          role: 'user',
          tier: 'Basic',
          credits: {
            remaining: 100,
            limit: 100,
            resetAt: Date.now() + 86_400_000,
          },
        });

        await expect(
          caller.chat.get({ sessionId: chat.sessionId }),
        ).rejects.toMatchObject({
          code: 'INTERNAL_SERVER_ERROR',
        });
      });
    });

    describe('data retrieval', () => {
      it('returns empty array for chat with no messages (zero)', async () => {
        const userId = createTestUserId();
        const chat = await createTestChat({ userId });

        const caller = createCaller({
          userId,
          role: 'user',
          tier: 'Basic',
          credits: {
            remaining: 100,
            limit: 100,
            resetAt: Date.now() + 86_400_000,
          },
        });

        const result = await caller.chat.get({ sessionId: chat.sessionId });

        expect(result).toEqual([]);
      });

      it('returns single message (one)', async () => {
        const userId = createTestUserId();
        const { chat } = await createTestChatWithMessages({
          userId,
          messageCount: 1,
        });

        const caller = createCaller({
          userId,
          role: 'user',
          tier: 'Basic',
          credits: {
            remaining: 100,
            limit: 100,
            resetAt: Date.now() + 86_400_000,
          },
        });

        const result = await caller.chat.get({ sessionId: chat.sessionId });

        expect(result).toHaveLength(1);
      });

      it('returns all messages in order (many)', async () => {
        const userId = createTestUserId();
        const { chat } = await createTestChatWithMessages({
          userId,
          messageCount: 10,
        });

        const caller = createCaller({
          userId,
          role: 'user',
          tier: 'Basic',
          credits: {
            remaining: 100,
            limit: 100,
            resetAt: Date.now() + 86_400_000,
          },
        });

        const result = await caller.chat.get({ sessionId: chat.sessionId });

        expect(result).toHaveLength(10);
        // Verify alternating user/assistant pattern
        expect(result[0]).toMatchObject({ role: 'user' });
        expect(result[1]).toMatchObject({ role: 'assistant' });
      });

      it('returns INTERNAL_SERVER_ERROR for non-existent chat', async () => {
        const caller = createCaller({
          userId: createTestUserId(),
          role: 'user',
          tier: 'Basic',
          credits: {
            remaining: 100,
            limit: 100,
            resetAt: Date.now() + 86_400_000,
          },
        });

        await expect(
          caller.chat.get({ sessionId: createTestSessionId() }),
        ).rejects.toMatchObject({
          code: 'INTERNAL_SERVER_ERROR',
        });
      });
    });
  });

  // ==========================================================================
  // BUSINESS LOGIC: delete
  // ==========================================================================
  describe('delete', () => {
    describe('ownership authorization', () => {
      it('rejects deleting chat owned by another user', async () => {
        const ownerUserId = createTestUserId('owner');
        const otherUserId = createTestUserId('other');
        const chat = await createTestChat({ userId: ownerUserId });

        const caller = createCaller({
          userId: otherUserId,
          role: 'user',
          tier: 'Basic',
          credits: {
            remaining: 100,
            limit: 100,
            resetAt: Date.now() + 86_400_000,
          },
        });

        await expect(
          caller.chat.delete({ sessionId: chat.sessionId }),
        ).rejects.toMatchObject({
          code: 'INTERNAL_SERVER_ERROR',
        });

        // Verify chat still exists
        const dbChat = await db
          .select()
          .from(chats)
          .where(eq(chats.sessionId, chat.sessionId));
        expect(dbChat).toHaveLength(1);
      });
    });

    describe('deletion behavior', () => {
      it('deletes chat and returns deleted record', async () => {
        const userId = createTestUserId();
        const chat = await createTestChat({ userId });

        const caller = createCaller({
          userId,
          role: 'user',
          tier: 'Basic',
          credits: {
            remaining: 100,
            limit: 100,
            resetAt: Date.now() + 86_400_000,
          },
        });

        const result = await caller.chat.delete({ sessionId: chat.sessionId });

        expect(result).toMatchObject({
          sessionId: chat.sessionId,
          userId,
        });

        // Verify chat is deleted from database
        const dbChat = await db
          .select()
          .from(chats)
          .where(eq(chats.sessionId, chat.sessionId));
        expect(dbChat).toHaveLength(0);
      });

      it('cascades delete to all messages', async () => {
        const userId = createTestUserId();
        const { chat } = await createTestChatWithMessages({
          userId,
          messageCount: 5,
        });

        const caller = createCaller({
          userId,
          role: 'user',
          tier: 'Basic',
          credits: {
            remaining: 100,
            limit: 100,
            resetAt: Date.now() + 86_400_000,
          },
        });

        await caller.chat.delete({ sessionId: chat.sessionId });

        // Verify all messages are deleted
        const dbMessages = await db
          .select()
          .from(messages)
          .where(eq(messages.sessionId, chat.sessionId));
        expect(dbMessages).toHaveLength(0);
      });

      it('returns INTERNAL_SERVER_ERROR for non-existent chat', async () => {
        const caller = createCaller({
          userId: createTestUserId(),
          role: 'user',
          tier: 'Basic',
          credits: {
            remaining: 100,
            limit: 100,
            resetAt: Date.now() + 86_400_000,
          },
        });

        await expect(
          caller.chat.delete({ sessionId: createTestSessionId() }),
        ).rejects.toMatchObject({
          code: 'INTERNAL_SERVER_ERROR',
        });
      });
    });
  });

  // ==========================================================================
  // BUSINESS LOGIC: adminList
  // ==========================================================================
  describe('adminList', () => {
    it('returns empty array when user has no chats (zero)', async () => {
      const targetUserId = createTestUserId('target');
      const adminUserId = createTestUserId('admin');

      const caller = createCaller({
        userId: adminUserId,
        role: 'admin',
        tier: 'Basic',
        credits: {
          remaining: 100,
          limit: 100,
          resetAt: Date.now() + 86_400_000,
        },
      });

      const result = await caller.chat.adminList({ userId: targetUserId });

      expect(result).toEqual([]);
    });

    it('returns single chat (one)', async () => {
      const targetUserId = createTestUserId('target');
      const adminUserId = createTestUserId('admin');

      await createTestChat({ userId: targetUserId });

      const caller = createCaller({
        userId: adminUserId,
        role: 'admin',
        tier: 'Basic',
        credits: {
          remaining: 100,
          limit: 100,
          resetAt: Date.now() + 86_400_000,
        },
      });

      const result = await caller.chat.adminList({ userId: targetUserId });

      expect(result).toHaveLength(1);
      expect(result[0]?.userId).toBe(targetUserId);
    });

    it('returns all chats for specified user only (many)', async () => {
      const targetUserId = createTestUserId('target');
      const otherUserId = createTestUserId('other');
      const adminUserId = createTestUserId('admin');

      // Create multiple chats for target user
      await createTestChat({ userId: targetUserId });
      await createTestChat({ userId: targetUserId });
      await createTestChat({ userId: targetUserId });

      // Create chat for different user (should not be included)
      await createTestChat({ userId: otherUserId });

      const caller = createCaller({
        userId: adminUserId,
        role: 'admin',
        tier: 'Basic',
        credits: {
          remaining: 100,
          limit: 100,
          resetAt: Date.now() + 86_400_000,
        },
      });

      const result = await caller.chat.adminList({ userId: targetUserId });

      expect(result).toHaveLength(3);
      for (const chat of result) {
        expect(chat.userId).toBe(targetUserId);
      }
    });
  });

  // ==========================================================================
  // BUSINESS LOGIC: stream (subscription)
  // ==========================================================================
  describe('stream', () => {
    // The rag-workflow is mocked in tests/backend/setup.ts to yield a fixed set
    // of deltas, so a fully-drained stream always accumulates this text.
    const MOCKED_RESPONSE = 'Test response from mocked LLM.';

    it('creates the Conversation and persists user + assistant Messages', async () => {
      const userId = createTestUserId();
      const sessionId = createTestSessionId();
      const caller = createCaller({
        userId,
        role: 'user',
        tier: 'Basic',
        credits: {
          remaining: 10,
          limit: 100,
          resetAt: Date.now() + 86_400_000,
        },
      });

      // Drive the subscription's async generator to completion.
      const stream = await caller.chat.stream({
        query: 'What is in my documents?',
        sessionId,
      });
      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      expect(chunks.length).toBeGreaterThan(0);

      // ensureChat created the Conversation row (sessionId was never created).
      const dbChat = await db
        .select()
        .from(chats)
        .where(eq(chats.sessionId, sessionId));
      expect(dbChat).toHaveLength(1);
      expect(dbChat[0]).toMatchObject({ sessionId, userId });

      // Both turns are persisted in order; the assistant turn carries the
      // accumulated streamed text.
      const dbMessages = await db
        .select()
        .from(messages)
        .where(eq(messages.sessionId, sessionId))
        .orderBy(asc(messages.timestamp));
      expect(dbMessages).toHaveLength(2);
      expect(dbMessages[0]).toMatchObject({
        role: 'user',
        text: 'What is in my documents?',
      });
      expect(dbMessages[1]).toMatchObject({
        role: 'assistant',
        text: MOCKED_RESPONSE,
      });
    });

    it('persists the user Message but no assistant Message on mid-stream error', async () => {
      const userId = createTestUserId();
      const sessionId = createTestSessionId();
      const caller = createCaller({
        userId,
        role: 'user',
        tier: 'Basic',
        credits: {
          remaining: 10,
          limit: 100,
          resetAt: Date.now() + 86_400_000,
        },
      });

      // Override the model for this case only: emit one chunk then fail.
      const querySpy = vi
        .spyOn(chatService, 'query')
        .mockImplementation(async function* () {
          yield { delta: 'partial ', raw: 'partial ' };
          throw new Error('LLM exploded mid-stream');
        });

      try {
        await expect(
          (async () => {
            const stream = await caller.chat.stream({
              query: 'Hello',
              sessionId,
            });
            for await (const _chunk of stream) {
              // drain until the underlying model throws
            }
          })(),
        ).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
      } finally {
        querySpy.mockRestore();
      }

      // The user turn is durable (recorded before the LLM call); the partial
      // assistant turn is discarded, leaving the turn retryable.
      const dbMessages = await db
        .select()
        .from(messages)
        .where(eq(messages.sessionId, sessionId));
      expect(dbMessages).toHaveLength(1);
      expect(dbMessages[0]).toMatchObject({ role: 'user', text: 'Hello' });
    });
  });
});
