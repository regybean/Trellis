/**
 * Seam 2 — chatGenerationProcessor direct invocation.
 *
 * Calls the processor directly (not through a BullMQ runner) with a real Redis
 * (testcontainer). LLM is stubbed at the chatAgent boundary; Postgres is real
 * (Mastra Memory).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Job } from '@acme/queue';
import { memory } from '@acme/rag';
import { redis } from '@acme/redis';

import type { GenerationJob } from '../../../../api/services/chat-queue';
import {
  chatAbortKey,
  chatInflightKey,
  chatRefundedKey,
  chatStreamKey,
} from '../../../../api/chat-keys';
import { chatAgent } from '../../../../api/services/chat-agent';
import { chatGenerationProcessor } from '../../../../api/services/chat-generation-processor';
import { fakeAgentStream, throwingAgentStream } from '../../setup';
import {
  createTestChat,
  createTestSessionId,
  createTestUserId,
} from '../../utils/fixtures';

function makeJob(overrides: Partial<GenerationJob> = {}): Job<GenerationJob> {
  const sessionId = createTestSessionId();
  const userId = createTestUserId();
  return {
    data: {
      conversationId: sessionId,
      turnId: crypto.randomUUID(),
      userId,
      tier: 'Basic',
      query: 'Hello, world!',
      ...overrides,
    },
  } as Job<GenerationJob>;
}

// xRange returns [id, fields[]] tuples; fields is a flat string array like
// ['type', 'done', 'messageId', 'abc123']. This helper reads a named field.
function streamField(fields: string[], name: string): string | undefined {
  const idx = fields.indexOf(name);
  if (idx === -1) return undefined;
  return fields.at(idx + 1);
}

describe('chatGenerationProcessor', () => {
  beforeEach(() => {
    vi.spyOn(chatAgent, 'stream').mockResolvedValue(
      fakeAgentStream(['Test ', 'response ', 'from ', 'mocked ', 'LLM.']),
    );
  });

  describe('clean completion', () => {
    it('publishes delta entries and a done terminal to the Redis Stream', async () => {
      const job = makeJob();
      const { conversationId } = job.data;

      await createTestChat({
        sessionId: conversationId,
        userId: job.data.userId,
      });
      await chatGenerationProcessor(job);

      const entries = await redis.xRange(
        chatStreamKey(conversationId),
        '-',
        '+',
      );
      expect(entries.length).toBeGreaterThan(1);

      const lastFields = entries.at(-1)?.[1] ?? [];
      expect(streamField(lastFields, 'type')).toBe('done');
    });

    it('persists the assistant Message so chat.get returns it', async () => {
      const job = makeJob();
      const { conversationId, userId } = job.data;

      await createTestChat({ sessionId: conversationId, userId });
      await chatGenerationProcessor(job);

      const { messages } = await memory.recall({
        threadId: conversationId,
        resourceId: userId,
        perPage: false,
      });
      const assistantMessages = messages.filter((m) => m.role === 'assistant');
      expect(assistantMessages).toHaveLength(1);
      expect(assistantMessages[0]?.content).toBeDefined();
    });

    it('includes the persisted messageId in the done terminal', async () => {
      const job = makeJob();
      const { conversationId, userId } = job.data;

      await createTestChat({ sessionId: conversationId, userId });
      await chatGenerationProcessor(job);

      const entries = await redis.xRange(
        chatStreamKey(conversationId),
        '-',
        '+',
      );
      const lastFields = entries.at(-1)?.[1] ?? [];
      expect(streamField(lastFields, 'type')).toBe('done');
      expect(streamField(lastFields, 'messageId')).toBeTruthy();
    });

    it('releases the in-flight lock after completion', async () => {
      const job = makeJob();
      const { conversationId, turnId } = job.data;

      await createTestChat({
        sessionId: conversationId,
        userId: job.data.userId,
      });

      // Simulate the lock being set (chat.send would do this normally)
      await redis.set(chatInflightKey(conversationId), turnId, {
        EX: 3600,
        NX: true,
      });

      await chatGenerationProcessor(job);

      const lock = await redis.get(chatInflightKey(conversationId));
      expect(lock).toBeNull();
    });

    it('sets the thread title on the first Turn', async () => {
      const job = makeJob({ query: 'What is the capital of France?' });
      const { conversationId, userId } = job.data;

      await createTestChat({ sessionId: conversationId, userId });
      await chatGenerationProcessor(job);

      const thread = await memory.getThreadById({ threadId: conversationId });
      expect(thread?.title).not.toBe('New conversation');
      expect(thread?.title).toBeTruthy();
    });
  });

  describe('abort path', () => {
    it('emits cancelled terminal and persists non-empty partial', async () => {
      const job = makeJob();
      const { conversationId, turnId, userId } = job.data;

      await createTestChat({ sessionId: conversationId, userId });

      vi.spyOn(chatAgent, 'stream').mockResolvedValue(
        fakeAgentStream(['partial response', ' more text']),
      );

      // Set abort signal before the processor starts so it fires on first check.
      await redis.set(chatAbortKey(conversationId), turnId, { EX: 300 });

      await chatGenerationProcessor(job);

      const entries = await redis.xRange(
        chatStreamKey(conversationId),
        '-',
        '+',
      );
      const lastFields = entries.at(-1)?.[1] ?? [];
      expect(streamField(lastFields, 'type')).toBe('cancelled');

      // Partial was non-empty, so messageId should be present
      expect(streamField(lastFields, 'messageId')).toBeTruthy();
    });

    it('emits cancelled terminal without messageId when partial is empty', async () => {
      const job = makeJob();
      const { conversationId, turnId, userId } = job.data;

      await createTestChat({ sessionId: conversationId, userId });

      // Empty stream — no chunks before abort
      vi.spyOn(chatAgent, 'stream').mockResolvedValue(fakeAgentStream([]));
      await redis.set(chatAbortKey(conversationId), turnId, { EX: 300 });

      await chatGenerationProcessor(job);

      const entries = await redis.xRange(
        chatStreamKey(conversationId),
        '-',
        '+',
      );
      const lastFields = entries.at(-1)?.[1] ?? [];
      expect(streamField(lastFields, 'type')).toBe('cancelled');
      expect(streamField(lastFields, 'messageId')).toBeUndefined();
    });
  });

  describe('error path', () => {
    it('emits error terminal and no assistant message is persisted', async () => {
      const job = makeJob();
      const { conversationId, userId } = job.data;

      await createTestChat({ sessionId: conversationId, userId });
      vi.spyOn(chatAgent, 'stream').mockResolvedValue(
        throwingAgentStream(['partial'], new Error('LLM exploded')),
      );

      await chatGenerationProcessor(job);

      const entries = await redis.xRange(
        chatStreamKey(conversationId),
        '-',
        '+',
      );
      const lastFields = entries.at(-1)?.[1] ?? [];
      expect(streamField(lastFields, 'type')).toBe('error');

      const { messages } = await memory.recall({
        threadId: conversationId,
        resourceId: userId,
        perPage: false,
      });
      expect(messages.filter((m) => m.role === 'assistant')).toHaveLength(0);
    });

    it('sets the refund guard key on error', async () => {
      const job = makeJob();
      const { conversationId, turnId, userId } = job.data;

      await createTestChat({ sessionId: conversationId, userId });
      vi.spyOn(chatAgent, 'stream').mockResolvedValue(
        throwingAgentStream([], new Error('LLM failed')),
      );

      await chatGenerationProcessor(job);

      const guardValue = await redis.get(chatRefundedKey(turnId));
      expect(guardValue).toBe('1');
    });

    it('does not double-refund when refund guard is already set', async () => {
      const job = makeJob();
      const { conversationId, turnId, userId } = job.data;

      await createTestChat({ sessionId: conversationId, userId });

      // Pre-set the guard (as if a previous refund path already ran).
      await redis.set(chatRefundedKey(turnId), '1', { NX: true });

      vi.spyOn(chatAgent, 'stream').mockResolvedValue(
        throwingAgentStream([], new Error('LLM failed')),
      );

      // Should not throw even with guard already set.
      await expect(chatGenerationProcessor(job)).resolves.not.toThrow();
    });
  });
});
