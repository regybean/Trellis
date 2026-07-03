/**
 * Chat Router Tests
 *
 * Testing philosophy:
 * - Test auth/validation ONCE since all procedures use the same middleware
 * - Focus on BUSINESS LOGIC with real database scenarios
 * - Test with "zero, one, many" pattern for data
 * - Use real DB/Redis via testcontainers or docker-compose
 * - Mock only external services (LLM via chatService spy)
 *
 * Conversations and messages are persisted by Mastra Memory; assertions read
 * back through the memory API rather than a chat-owned table.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { memory } from '@acme/rag';

import type { TestContextOptions } from '../../utils/test-context';
import { appRouter } from '../../../../api/root';
import { chatAgent } from '../../../../api/services/chat-agent';
import { throwingAgentStream } from '../../setup';
import {
  createTestChat,
  createTestChatWithMessages,
  createTestSessionId,
  createTestUserId,
} from '../../utils/fixtures';
import { cleanupTestData, createTestContext } from '../../utils/test-context';

// Helper to create a tRPC caller with the given context options
function createCaller(opts: TestContextOptions) {
  const ctx = createTestContext(opts);
  return appRouter.createCaller(ctx);
}

// Hoisted so the predicate isn't a 5th-level nested function inside describe/it.
function findBySession<T extends { sessionId: string }>(
  items: T[],
  sessionId: string,
) {
  return items.find((c) => c.sessionId === sessionId);
}

const baseCredits = {
  remaining: 100,
  limit: 100,
  resetAt: Date.now() + 86_400_000,
};

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
          credits: baseCredits,
        });

        await expect(
          caller.chat.adminGet({ sessionId: createTestSessionId() }),
        ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
      });

      it('allows admin users', async () => {
        const ownerUserId = createTestUserId('owner');
        const adminUserId = createTestUserId('admin');
        const chat = await createTestChat({ userId: ownerUserId });

        const caller = createCaller({
          userId: adminUserId,
          role: 'admin',
          tier: 'Basic',
          credits: baseCredits,
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
        ).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
      });
    });

    // Ownership is seated at the request pipeline by the conversation builders
    // (`ownedConversationProcedure` / `existingConversationProcedure`), so it is
    // tested once here across both builders rather than per procedure.
    describe('conversation ownership', () => {
      it('rejects reading a conversation owned by another user (existing builder)', async () => {
        const ownerUserId = createTestUserId('owner');
        const otherUserId = createTestUserId('other');
        const { chat } = await createTestChatWithMessages({
          userId: ownerUserId,
        });

        const caller = createCaller({
          userId: otherUserId,
          role: 'user',
          tier: 'Basic',
          credits: baseCredits,
        });

        await expect(
          caller.chat.get({ sessionId: chat.sessionId }),
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      });

      it('rejects deleting a conversation owned by another user, leaving it intact', async () => {
        const ownerUserId = createTestUserId('owner');
        const otherUserId = createTestUserId('other');
        const chat = await createTestChat({ userId: ownerUserId });

        const caller = createCaller({
          userId: otherUserId,
          role: 'user',
          tier: 'Basic',
          credits: baseCredits,
        });

        await expect(
          caller.chat.delete({ sessionId: chat.sessionId }),
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });

        const thread = await memory.getThreadById({ threadId: chat.sessionId });
        expect(thread).not.toBeNull();
      });

      it('rejects creating against a conversation owned by another user (owned builder)', async () => {
        const ownerUserId = createTestUserId('owner');
        const otherUserId = createTestUserId('other');
        const chat = await createTestChat({ userId: ownerUserId });

        const caller = createCaller({
          userId: otherUserId,
          role: 'user',
          tier: 'Basic',
          credits: baseCredits,
        });

        await expect(
          caller.chat.create({ sessionId: chat.sessionId }),
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      });

      it('returns empty history when reading a not-yet-created conversation', async () => {
        // `get` treats an absent thread as a brand-new session (no messages
        // yet) and returns [], rather than 404 — see chat.ts. A foreign
        // *existing* conversation is still rejected FORBIDDEN by the ownership
        // middleware; `delete` (below) is the one that 404s on absence.
        const caller = createCaller({
          userId: createTestUserId(),
          role: 'user',
          tier: 'Basic',
          credits: baseCredits,
        });

        await expect(
          caller.chat.get({ sessionId: createTestSessionId() }),
        ).resolves.toEqual([]);
      });

      it('returns NOT_FOUND when deleting an absent conversation', async () => {
        const caller = createCaller({
          userId: createTestUserId(),
          role: 'user',
          tier: 'Basic',
          credits: baseCredits,
        });

        await expect(
          caller.chat.delete({ sessionId: createTestSessionId() }),
        ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      });

      it('enforces ownership before rate limiting on stream', async () => {
        const ownerUserId = createTestUserId('owner');
        const otherUserId = createTestUserId('other');
        const chat = await createTestChat({ userId: ownerUserId });

        const caller = createCaller({
          userId: otherUserId,
          role: 'user',
          tier: 'Basic',
          credits: {
            remaining: 0,
            limit: 100,
            resetAt: Date.now() + 86_400_000,
          },
        });

        // Zero credits would yield TOO_MANY_REQUESTS if rate limiting ran first;
        // FORBIDDEN proves ownership is checked before credits are consumed.
        await expect(
          caller.chat.stream({ query: 'test', sessionId: chat.sessionId }),
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
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
        credits: baseCredits,
      });

      const result = await caller.chat.create({ sessionId });

      expect(result).toMatchObject({ sessionId, userId });

      const thread = await memory.getThreadById({ threadId: sessionId });
      expect(thread).not.toBeNull();
      expect(thread?.resourceId).toBe(userId);
    });

    it('returns existing chat if sessionId already exists (idempotent)', async () => {
      const userId = createTestUserId();
      const existingChat = await createTestChat({ userId });
      const caller = createCaller({
        userId,
        role: 'user',
        tier: 'Basic',
        credits: baseCredits,
      });

      const result = await caller.chat.create({
        sessionId: existingChat.sessionId,
      });

      expect(result).toMatchObject({
        sessionId: existingChat.sessionId,
        userId,
      });
    });
  });

  // ==========================================================================
  // BUSINESS LOGIC: get
  // ==========================================================================
  describe('get', () => {
    describe('data retrieval', () => {
      it('returns empty array for chat with no messages (zero)', async () => {
        const userId = createTestUserId();
        const chat = await createTestChat({ userId });

        const caller = createCaller({
          userId,
          role: 'user',
          tier: 'Basic',
          credits: baseCredits,
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
          credits: baseCredits,
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
          credits: baseCredits,
        });

        const result = await caller.chat.get({ sessionId: chat.sessionId });

        expect(result).toHaveLength(10);
        expect(result[0]).toMatchObject({ role: 'user' });
        expect(result[1]).toMatchObject({ role: 'assistant' });
      });
    });
  });

  // ==========================================================================
  // BUSINESS LOGIC: delete
  // ==========================================================================
  describe('delete', () => {
    describe('deletion behavior', () => {
      it('deletes chat and returns deleted record', async () => {
        const userId = createTestUserId();
        const chat = await createTestChat({ userId });

        const caller = createCaller({
          userId,
          role: 'user',
          tier: 'Basic',
          credits: baseCredits,
        });

        const result = await caller.chat.delete({ sessionId: chat.sessionId });

        expect(result).toMatchObject({ sessionId: chat.sessionId, userId });

        const thread = await memory.getThreadById({ threadId: chat.sessionId });
        expect(thread).toBeNull();
      });
    });
  });

  // ==========================================================================
  // BUSINESS LOGIC: list
  // ==========================================================================
  describe('list', () => {
    it('returns empty array for a user with no conversations (zero)', async () => {
      const userId = createTestUserId();
      const caller = createCaller({
        userId,
        role: 'user',
        tier: 'Basic',
        credits: baseCredits,
      });

      const result = await caller.chat.list();

      expect(result).toEqual([]);
    });

    it("returns only the caller's own conversations (many)", async () => {
      const userId = createTestUserId();
      const otherUserId = createTestUserId('other');

      const chat1 = await createTestChat({ userId });
      const chat2 = await createTestChat({ userId });
      await createTestChat({ userId: otherUserId });

      const caller = createCaller({
        userId,
        role: 'user',
        tier: 'Basic',
        credits: baseCredits,
      });

      const result = await caller.chat.list();

      expect(result).toHaveLength(2);
      const sessionIds = result.map((c) => c.sessionId);
      expect(sessionIds).toContain(chat1.sessionId);
      expect(sessionIds).toContain(chat2.sessionId);
    });
  });

  // ==========================================================================
  // BUSINESS LOGIC: setFolder
  // ==========================================================================
  describe('setFolder', () => {
    it('assigns a conversation to an owned folder', async () => {
      const userId = createTestUserId();
      const chat = await createTestChat({ userId });
      const folderId = createTestSessionId();
      const caller = createCaller({
        userId,
        role: 'user',
        tier: 'Basic',
        credits: baseCredits,
      });

      await caller.chat.folders.create({ id: folderId, name: 'My Folder' });
      const result = await caller.chat.setFolder({
        sessionId: chat.sessionId,
        folderId,
      });

      expect(result).toEqual({ sessionId: chat.sessionId, folderId });

      const listed = await caller.chat.list();
      const conv = listed.find((c) => c.sessionId === chat.sessionId);
      expect(conv?.folderId).toBe(folderId);
    });

    it('clears a folder assignment with folderId: null', async () => {
      const userId = createTestUserId();
      const chat = await createTestChat({ userId });
      const folderId = createTestSessionId();
      const caller = createCaller({
        userId,
        role: 'user',
        tier: 'Basic',
        credits: baseCredits,
      });

      await caller.chat.folders.create({ id: folderId, name: 'My Folder' });
      await caller.chat.setFolder({ sessionId: chat.sessionId, folderId });

      const result = await caller.chat.setFolder({
        sessionId: chat.sessionId,
        folderId: null,
      });

      expect(result).toEqual({ sessionId: chat.sessionId, folderId: null });

      const listed = await caller.chat.list();
      const conv = listed.find((c) => c.sessionId === chat.sessionId);
      expect(conv?.folderId).toBeNull();
    });

    it('rejects a folder owned by another user', async () => {
      const userId = createTestUserId();
      const otherUserId = createTestUserId('other');
      const chat = await createTestChat({ userId });
      const folderId = createTestSessionId();

      const otherCaller = createCaller({
        userId: otherUserId,
        role: 'user',
        tier: 'Basic',
        credits: baseCredits,
      });
      await otherCaller.chat.folders.create({ id: folderId, name: 'Theirs' });

      const caller = createCaller({
        userId,
        role: 'user',
        tier: 'Basic',
        credits: baseCredits,
      });
      await expect(
        caller.chat.setFolder({ sessionId: chat.sessionId, folderId }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  // ==========================================================================
  // BUSINESS LOGIC: folders CRUD
  // ==========================================================================
  describe('folders', () => {
    describe('list', () => {
      it('returns empty array when user has no folders (zero)', async () => {
        const userId = createTestUserId();
        const caller = createCaller({
          userId,
          role: 'user',
          tier: 'Basic',
          credits: baseCredits,
        });

        expect(await caller.chat.folders.list()).toEqual([]);
      });

      it("returns only the caller's own folders (one)", async () => {
        const userId = createTestUserId();
        const otherUserId = createTestUserId('other');
        const folderId = createTestSessionId();
        const caller = createCaller({
          userId,
          role: 'user',
          tier: 'Basic',
          credits: baseCredits,
        });
        const otherCaller = createCaller({
          userId: otherUserId,
          role: 'user',
          tier: 'Basic',
          credits: baseCredits,
        });

        await caller.chat.folders.create({ id: folderId, name: 'Mine' });
        await otherCaller.chat.folders.create({
          id: createTestSessionId(),
          name: 'Theirs',
        });

        const result = await caller.chat.folders.list();

        expect(result).toHaveLength(1);
        expect(result[0]?.id).toBe(folderId);
        expect(result[0]?.name).toBe('Mine');
      });
    });

    describe('delete', () => {
      it('removes the folder and returns its id', async () => {
        const userId = createTestUserId();
        const folderId = createTestSessionId();
        const caller = createCaller({
          userId,
          role: 'user',
          tier: 'Basic',
          credits: baseCredits,
        });

        await caller.chat.folders.create({ id: folderId, name: 'To Delete' });
        const result = await caller.chat.folders.delete({ id: folderId });

        expect(result).toEqual({ id: folderId });
        expect(await caller.chat.folders.list()).toEqual([]);
      });

      it('does not remove conversations assigned to the deleted folder (lazy delete)', async () => {
        const userId = createTestUserId();
        const folderId = createTestSessionId();
        const caller = createCaller({
          userId,
          role: 'user',
          tier: 'Basic',
          credits: baseCredits,
        });

        const chat = await createTestChat({ userId });
        await caller.chat.folders.create({ id: folderId, name: 'Folder' });
        await caller.chat.setFolder({ sessionId: chat.sessionId, folderId });

        await caller.chat.folders.delete({ id: folderId });

        // Conversation still exists; folderId now dangling (resolved as null by client)
        const listed = await caller.chat.list();
        const conv = findBySession(listed, chat.sessionId);
        expect(conv).toBeDefined();
        expect(conv?.folderId).toBe(folderId); // dangling — not cleared by the delete
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
        credits: baseCredits,
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
        credits: baseCredits,
      });

      const result = await caller.chat.adminList({ userId: targetUserId });

      expect(result).toHaveLength(1);
      expect(result[0]?.userId).toBe(targetUserId);
    });

    it('returns all chats for specified user only (many)', async () => {
      const targetUserId = createTestUserId('target');
      const otherUserId = createTestUserId('other');
      const adminUserId = createTestUserId('admin');

      await createTestChat({ userId: targetUserId });
      await createTestChat({ userId: targetUserId });
      await createTestChat({ userId: targetUserId });
      await createTestChat({ userId: otherUserId });

      const caller = createCaller({
        userId: adminUserId,
        role: 'admin',
        tier: 'Basic',
        credits: baseCredits,
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
    // chatAgent.stream is mocked in tests/backend/setup.ts to yield a fixed set
    // of chunks; a fully-drained stream always accumulates this text.
    const MOCKED_RESPONSE = 'Test response from mocked LLM.';

    it('streams the accumulated assistant response', async () => {
      const userId = createTestUserId();
      const sessionId = createTestSessionId();
      // The real agent stamps the thread as a side effect of streaming; the
      // mocked agent does not, so seed it here. Without it the post-stream
      // `latestAssistantMessageId` recall throws "No thread found".
      await createTestChat({ userId, sessionId });
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

      const stream = await caller.chat.stream({
        query: 'What is in my documents?',
        sessionId,
      });

      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);
      // The last message event carries the fully accumulated response, followed
      // by a terminal `done` event.
      const messageEvents = chunks.filter((c) => c.type === 'message');
      expect(messageEvents.at(-1)).toMatchObject({
        type: 'message',
        acc: MOCKED_RESPONSE,
      });
      expect(chunks.at(-1)).toMatchObject({
        type: 'done',
        sessionId,
      });
    });

    it('surfaces a mid-stream failure as INTERNAL_SERVER_ERROR', async () => {
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

      const querySpy = vi
        .spyOn(chatAgent, 'stream')
        .mockResolvedValue(
          throwingAgentStream(
            ['partial '],
            new Error('LLM exploded mid-stream'),
          ),
        );

      try {
        await expect(
          (async () => {
            const stream = await caller.chat.stream({
              query: 'Hello',
              sessionId,
            });
            // Drain via the iterator (not for-await) so there's no loop binding
            // to leave unused; `.done` is read off a variable, not the await.
            const iterator = stream[Symbol.asyncIterator]();
            let next = await iterator.next();
            while (!next.done) next = await iterator.next();
          })(),
        ).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
      } finally {
        querySpy.mockRestore();
      }
    });
  });
});
