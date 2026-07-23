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

import { beforeEach, describe, expect, it } from 'vitest';

import { memory } from '@acme/rag';
import { nsKey, redis } from '@acme/redis';

import type { StreamReaderEvent } from '../../../../api/schemas/chat-schema';
import type { TestContextOptions } from '../../utils/test-context';
import {
  chatAbortKey,
  chatInflightKey,
  chatRefundedKey,
  chatStreamKey,
} from '../../../../api/chat-keys';
import { appRouter } from '../../../../api/root';
import {
  _generationQueue,
  generationJobId,
} from '../../../../api/services/chat-queue';
import { tailChatStream } from '../../../../api/services/chat-stream-reader';
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

// Drive the pure reader to completion, returning the ordered { id, event }
// entries it re-emitted. With no In-flight lock present the reader drains what
// exists in the Stream and closes, so this resolves deterministically.
async function drainReader(conversationId: string, lastEventId?: string) {
  const out: { id: string; event: StreamReaderEvent }[] = [];
  for await (const entry of tailChatStream(
    conversationId,
    lastEventId ?? null,
  )) {
    out.push(entry);
  }
  return out;
}

const baseCredits = {
  remaining: 100,
  limit: 100,
  resetAt: Date.now() + 86_400_000,
};

// The Redis credit key for a test user on the Basic tier — the tier the caller
// contexts below use, so refunds land on the key reconcileTurn writes.
const creditKey = (userId: string) => nsKey('credits', userId, 'Basic');

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

    // Credit consumption moved into `chat.send` (rate-limit middleware is no
    // longer wired onto any chat procedure after the durable-stream split); the
    // consume gate is covered under `send` below.

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

      it('rejects reading a conversation owned by another user (byId builder)', async () => {
        const ownerUserId = createTestUserId('owner');
        const otherUserId = createTestUserId('other');
        const chat = await createTestChat({ userId: ownerUserId });

        const caller = createCaller({
          userId: otherUserId,
          role: 'user',
          tier: 'Basic',
          credits: baseCredits,
        });

        // The pure reader is built on `ownedConversationByIdProcedure`; the
        // ownership adapter rejects before the subscription generator runs.
        await expect(
          caller.chat.stream({ conversationId: chat.sessionId }),
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
  // BUSINESS LOGIC: stream — the pure reader (Seam 1)
  //
  // `chat.stream` is a stateless tail of the Redis Stream the Generation worker
  // produces; it performs no writes, no LLM call, no lock operations. The
  // observable contract is: given the Redis entries a worker would have written,
  // the reader re-emits them in order, resumes strictly after `lastEventId`, and
  // closes once it re-emits a terminal. The reader is exercised through its
  // generator `tailChatStream` against real Redis — the tRPC wrapping (ownership
  // + `tracked`) is covered by the ownership test above. With no In-flight lock
  // present the reader drains what exists and closes, keeping these deterministic
  // (no dependence on poll timing).
  // ==========================================================================
  describe('stream (reader)', () => {
    it('coalesces consecutive deltas drained in one batch, then closes on the done terminal', async () => {
      const conversationId = createTestSessionId();
      const streamKey = chatStreamKey(conversationId);
      await redis.xAdd(streamKey, '*', { chunk: 'Hello' });
      await redis.xAdd(streamKey, '*', { chunk: ' world' });
      await redis.xAdd(streamKey, '*', { type: 'done', messageId: 'msg-1' });
      // A post-terminal entry must never be re-emitted — the reader closes first.
      await redis.xAdd(streamKey, '*', { chunk: ' orphaned' });

      const entries = await drainReader(conversationId);

      // Consecutive deltas that arrive in a single xRange collapse into one
      // delta carrying the full text (the resume-jitter fix: one client render
      // for the backlog instead of one per token); the terminal follows.
      expect(entries.map((e) => e.event)).toEqual([
        { type: 'delta', chunk: 'Hello world' },
        { type: 'done', messageId: 'msg-1' },
      ]);
    });

    it('resumes strictly after lastEventId (no duplicates, no gaps)', async () => {
      const conversationId = createTestSessionId();
      const streamKey = chatStreamKey(conversationId);
      await redis.xAdd(streamKey, '*', { chunk: 'a' });
      await redis.xAdd(streamKey, '*', { chunk: 'b' });

      // First attach coalesces the backlog into one delta carrying the id of
      // the LAST entry it consumed — that id is the client's Last-Event-ID.
      const first = await drainReader(conversationId);
      expect(first.map((e) => e.event)).toEqual([
        { type: 'delta', chunk: 'ab' },
      ]);
      const lastSeenId = first.at(-1)?.id;
      expect(lastSeenId).toBeDefined();

      // More tokens land, then the terminal.
      await redis.xAdd(streamKey, '*', { chunk: 'c' });
      await redis.xAdd(streamKey, '*', { type: 'done', messageId: 'm' });

      // Resuming after the coalesced id sees only what came after — no re-read
      // of a/b, no gap before c.
      const resumed = await drainReader(conversationId, lastSeenId);
      expect(resumed.map((e) => e.event)).toEqual([
        { type: 'delta', chunk: 'c' },
        { type: 'done', messageId: 'm' },
      ]);
    });

    it('carries messageId on a cancelled terminal with a persisted partial', async () => {
      const conversationId = createTestSessionId();
      const streamKey = chatStreamKey(conversationId);
      await redis.xAdd(streamKey, '*', { chunk: 'partial' });
      await redis.xAdd(streamKey, '*', {
        type: 'cancelled',
        messageId: 'msg-partial',
      });

      const entries = await drainReader(conversationId);

      expect(entries.map((e) => e.event)).toEqual([
        { type: 'delta', chunk: 'partial' },
        { type: 'cancelled', messageId: 'msg-partial' },
      ]);
    });

    it('emits a cancelled terminal with null messageId when nothing was persisted', async () => {
      const conversationId = createTestSessionId();
      await redis.xAdd(chatStreamKey(conversationId), '*', {
        type: 'cancelled',
      });

      const entries = await drainReader(conversationId);

      expect(entries.map((e) => e.event)).toEqual([
        { type: 'cancelled', messageId: null },
      ]);
    });

    it('emits an error terminal carrying no messageId', async () => {
      const conversationId = createTestSessionId();
      await redis.xAdd(chatStreamKey(conversationId), '*', { type: 'error' });

      const entries = await drainReader(conversationId);

      expect(entries.map((e) => e.event)).toEqual([{ type: 'error' }]);
    });

    it('rejects a malformed terminal rather than misclassifying it as a delta', async () => {
      // A producer typo (`type: 'don'`) must surface, not silently degrade to a
      // non-terminal delta — which would leave a live reader polling forever.
      const conversationId = createTestSessionId();
      await redis.xAdd(chatStreamKey(conversationId), '*', { type: 'don' });

      await expect(drainReader(conversationId)).rejects.toThrow();
    });

    it('closes with an empty stream when no Turn is in-flight and no Stream exists', async () => {
      const conversationId = createTestSessionId();

      const entries = await drainReader(conversationId);

      expect(entries).toEqual([]);
    });
  });

  // ==========================================================================
  // DURABLE-STREAM CONTROL PLANE: send / stop / reconcileTurn (Seam 1)
  //
  // The observable contract: Redis lock + abort keys, the persisted user
  // Message (via chat.get), the enqueued job, and the discriminated returns.
  // Credit *consumption* runs through the mock entitlements provider (a no-op in
  // the caller harness — real decrement is covered in @acme/subscriptions), so
  // the credit contract asserted here is the rate-limit *gate* and the refund
  // path (which does hit real Redis).
  // ==========================================================================
  describe('send', () => {
    it('acquires the lock, persists the user Message, enqueues a job, returns accepted', async () => {
      const userId = createTestUserId();
      const conversationId = createTestSessionId();
      const turnId = crypto.randomUUID();
      const caller = createCaller({
        userId,
        role: 'user',
        tier: 'Basic',
        credits: baseCredits,
      });

      const result = await caller.chat.send({
        query: 'Hello there',
        conversationId,
        turnId,
      });

      expect(result).toEqual({ status: 'accepted', turnId });

      // In-flight lock holds this Turn.
      expect(await redis.get(chatInflightKey(conversationId))).toBe(turnId);

      // User Message durable in chat.get before any token is generated.
      const messages = await caller.chat.get({ sessionId: conversationId });
      const userMessages = messages.filter((m) => m.role === 'user');
      expect(userMessages).toHaveLength(1);
      expect(userMessages[0]?.text).toBe('Hello there');

      // Job present in the generation queue, keyed by conversationId:turnId.
      const job = await _generationQueue.getJob(
        generationJobId(conversationId, turnId),
      );
      expect(job?.data).toMatchObject({ conversationId, turnId, userId });
    });

    it('discards a prior Turn residual Stream so the next reader never replays it', async () => {
      // Regression (#43): the Stream is Conversation-keyed and lingers after a
      // terminal on a brief TTL. Without the winner-path cleanup, the next
      // Turn's reader tails from the head and re-reads the PRIOR Turn's deltas
      // and `done` — printing the last response again and colliding on its
      // messageId. Seed a completed Turn's residue, then start a fresh Turn.
      const userId = createTestUserId();
      const conversationId = createTestSessionId();
      const streamKey = chatStreamKey(conversationId);
      await redis.xAdd(streamKey, '*', { chunk: 'previous answer' });
      await redis.xAdd(streamKey, '*', { type: 'done', messageId: 'msg-prev' });

      const caller = createCaller({
        userId,
        role: 'user',
        tier: 'Basic',
        credits: baseCredits,
      });

      await caller.chat.send({
        query: 'second question',
        conversationId,
        turnId: crypto.randomUUID(),
      });

      // The prior residue is gone, so a reader attaching for this Turn tails a
      // clean Stream instead of replaying the previous one. (We assert the
      // Stream directly rather than draining the reader: chat.send holds the
      // In-flight lock for the worker, so the pure reader would poll for the
      // not-yet-produced Turn rather than close.)
      expect(await redis.xRange(streamKey, '-', '+')).toHaveLength(0);
    });

    it('does not discard a live Stream when it returns alreadyInflight', async () => {
      // A second tab that loses the lock must NOT delete the winner's in-flight
      // Stream — only the lock-winner performs the stale-Stream cleanup.
      const userId = createTestUserId();
      const conversationId = createTestSessionId();
      await createTestChat({ userId, sessionId: conversationId });
      const streamKey = chatStreamKey(conversationId);

      // Simulate a Turn already in flight: lock held + a delta on the wire.
      await redis.set(chatInflightKey(conversationId), crypto.randomUUID());
      await redis.xAdd(streamKey, '*', { chunk: 'live token' });

      const caller = createCaller({
        userId,
        role: 'user',
        tier: 'Basic',
        credits: baseCredits,
      });

      const result = await caller.chat.send({
        query: 'racing send',
        conversationId,
        turnId: crypto.randomUUID(),
      });

      expect(result).toEqual({ status: 'alreadyInflight' });
      // The live Stream is untouched — the attaching tab still sees the token.
      expect(await redis.xRange(streamKey, '-', '+')).toHaveLength(1);
    });

    it('returns alreadyInflight without duplicating work on a two-tab race', async () => {
      const userId = createTestUserId();
      const conversationId = createTestSessionId();
      await createTestChat({ userId, sessionId: conversationId });
      const caller = createCaller({
        userId,
        role: 'user',
        tier: 'Basic',
        credits: baseCredits,
      });

      // Two tabs fire concurrently with distinct turnIds; the SET NX lock admits
      // exactly one.
      const [a, b] = await Promise.all([
        caller.chat.send({
          query: 'first',
          conversationId,
          turnId: crypto.randomUUID(),
        }),
        caller.chat.send({
          query: 'second',
          conversationId,
          turnId: crypto.randomUUID(),
        }),
      ]);

      const statuses = [a.status, b.status];
      expect(statuses).toContain('accepted');
      expect(statuses).toContain('alreadyInflight');

      // Only the winner had any side effect: one user Message, not two — so the
      // loser could not have double-charged either.
      const messages = await caller.chat.get({ sessionId: conversationId });
      expect(messages.filter((m) => m.role === 'user')).toHaveLength(1);
    });

    it('rejects TOO_MANY_REQUESTS and releases the lock when credits are exhausted', async () => {
      const userId = createTestUserId();
      const conversationId = createTestSessionId();
      const caller = createCaller({
        userId,
        role: 'user',
        tier: 'Basic',
        credits: { remaining: 0, limit: 100, resetAt: Date.now() + 86_400_000 },
      });

      await expect(
        caller.chat.send({
          query: 'Hello',
          conversationId,
          turnId: crypto.randomUUID(),
        }),
      ).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });

      // Lock released on the credit rejection — the Conversation is not wedged
      // for the lock's TTL.
      expect(await redis.get(chatInflightKey(conversationId))).toBeNull();
    });
  });

  describe('inflightTurn (resume probe)', () => {
    it('reports the in-flight turnId while a Turn is generating', async () => {
      const userId = createTestUserId();
      const conversationId = createTestSessionId();
      const turnId = crypto.randomUUID();
      const caller = createCaller({
        userId,
        role: 'user',
        tier: 'Basic',
        credits: baseCredits,
      });

      await caller.chat.send({ query: 'Hello', conversationId, turnId });

      // A client reloading mid-generation reads this to decide whether to
      // reopen the reader and resume.
      expect(await caller.chat.inflightTurn({ conversationId })).toEqual({
        turnId,
      });
    });

    it('reports null when no Turn is in flight', async () => {
      const userId = createTestUserId();
      const conversationId = createTestSessionId();
      await createTestChat({ userId, sessionId: conversationId });
      const caller = createCaller({
        userId,
        role: 'user',
        tier: 'Basic',
        credits: baseCredits,
      });

      expect(await caller.chat.inflightTurn({ conversationId })).toEqual({
        turnId: null,
      });
    });
  });

  describe('stop', () => {
    it('publishes the abort signal keyed by the in-flight turnId', async () => {
      const userId = createTestUserId();
      const conversationId = createTestSessionId();
      const turnId = crypto.randomUUID();
      const caller = createCaller({
        userId,
        role: 'user',
        tier: 'Basic',
        credits: baseCredits,
      });

      await caller.chat.send({ query: 'Hello', conversationId, turnId });
      const result = await caller.chat.stop({ conversationId });

      expect(result).toEqual({ status: 'stopped', turnId });
      expect(await redis.get(chatAbortKey(conversationId))).toBe(turnId);
    });

    it('is a no-op when no Turn is in flight', async () => {
      const userId = createTestUserId();
      const conversationId = createTestSessionId();
      await createTestChat({ userId, sessionId: conversationId });
      const caller = createCaller({
        userId,
        role: 'user',
        tier: 'Basic',
        credits: baseCredits,
      });

      expect(await caller.chat.stop({ conversationId })).toEqual({
        status: 'notInflight',
      });
    });
  });

  describe('reconcileTurn', () => {
    it('refunds the credit once; the second call is a no-op', async () => {
      const userId = createTestUserId();
      const conversationId = createTestSessionId();
      const turnId = crypto.randomUUID();
      await createTestChat({ userId, sessionId: conversationId });
      const caller = createCaller({
        userId,
        role: 'user',
        tier: 'Basic',
        credits: baseCredits,
      });

      await redis.set(creditKey(userId), '5');

      const first = await caller.chat.reconcileTurn({ conversationId, turnId });
      expect(first).toEqual({ refunded: true });
      expect(await redis.get(creditKey(userId))).toBe('6');
      expect(await redis.get(chatRefundedKey(turnId))).toBe('1');

      const second = await caller.chat.reconcileTurn({
        conversationId,
        turnId,
      });
      expect(second).toEqual({ refunded: false });
      // No double refund: the guard held.
      expect(await redis.get(creditKey(userId))).toBe('6');
    });

    it('clears the in-flight lock and deletes the Stream key', async () => {
      const userId = createTestUserId();
      const conversationId = createTestSessionId();
      const turnId = crypto.randomUUID();
      await createTestChat({ userId, sessionId: conversationId });
      const caller = createCaller({
        userId,
        role: 'user',
        tier: 'Basic',
        credits: baseCredits,
      });

      // Simulate an orphaned Turn: a lock and a partial Stream left by a worker
      // that crashed before writing a terminal.
      await redis.set(chatInflightKey(conversationId), turnId);
      await redis.xAdd(chatStreamKey(conversationId), '*', {
        chunk: 'partial',
      });

      await caller.chat.reconcileTurn({ conversationId, turnId });

      expect(await redis.get(chatInflightKey(conversationId))).toBeNull();
      expect(
        await redis.xRange(chatStreamKey(conversationId), '-', '+'),
      ).toHaveLength(0);
    });
  });
});
