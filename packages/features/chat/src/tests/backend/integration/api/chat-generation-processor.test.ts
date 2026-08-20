/**
 * Seam 2 — chatGenerationProcessor direct invocation.
 *
 * Calls the processor directly (not through a BullMQ runner) with a real Redis
 * (testcontainer). LLM is stubbed at the chatAgent boundary; Postgres is real
 * (Mastra Memory).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  EntitlementsProvider,
  SubscriptionTier,
} from '@acme/entitlements';
import type { Job } from '@acme/queue';
import { memory } from '@acme/rag';
import { redis } from '@acme/redis';
import { createMockEntitlements } from '@acme/trpc/testing';

import type { GenerationJob } from '../../../../api/services/chat-queue';
import {
  chatAbortKey,
  chatInflightKey,
  chatRefundedKey,
  chatStreamKey,
} from '../../../../api/chat-keys';
import { chatAgent } from '../../../../api/services/chat-agent';
import { createChatGenerationProcessor } from '../../../../api/services/chat-generation-processor';
import { chatStream, coalesce } from '../../../../api/services/chat-stream';
import { chatConfig } from '../../../../config';
import { configContext } from '../../../../env';
import { fakeAgentStream, throwingAgentStream } from '../../setup';
import {
  createTestChat,
  createTestSessionId,
  createTestUserId,
} from '../../utils/fixtures';

// CREDITS_PER_TURN has one origin in config (ADR 0026) — the same value the
// worker's refund charges, read here to assert the refund amount.
const { CREDITS_PER_TURN } = chatConfig(configContext);

interface RefundCall {
  userId: string;
  tier: SubscriptionTier;
  amount: number;
}

// Build a provider that records refunds so the error→refund path can be
// asserted through the INJECTED seam (never a `vi.mock` of a seam the feature
// owns; the provider IS the injection point). Everything else is the real mock
// provider from @acme/trpc/testing.
function makeRecordingProvider() {
  const refundCalls: RefundCall[] = [];
  const provider: EntitlementsProvider = {
    ...createMockEntitlements({
      tier: 'Basic',
      credits: { remaining: 100, limit: 100, resetAt: 0 },
    }),
    refund(userId, tier, amount) {
      refundCalls.push({ userId, tier, amount });
      return Promise.resolve();
    },
  };
  return { provider, refundCalls };
}

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

// Read the whole Stream back through the SAME codec + coalesce the reader uses,
// so the producer is asserted symmetrically to the consumer (the writer wrote it,
// the durable stream's `decode` + chat's `coalesce` decode it) — never by
// hand-indexing raw fields.
async function readStreamEvents(conversationId: string) {
  const entries = await chatStream(conversationId).read();
  return coalesce(entries).map((e) => e.event);
}

describe('chatGenerationProcessor', () => {
  let refundCalls: RefundCall[];
  let processor: ReturnType<typeof createChatGenerationProcessor>;

  beforeEach(() => {
    const recording = makeRecordingProvider();
    refundCalls = recording.refundCalls;
    processor = createChatGenerationProcessor(recording.provider);

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
      await processor(job);

      const entries = await redis.xRange(
        chatStreamKey(conversationId),
        '-',
        '+',
      );
      expect(entries.length).toBeGreaterThan(1);

      const lastFields = entries.at(-1)?.[1] ?? [];
      expect(streamField(lastFields, 'type')).toBe('done');
    });

    it('publishes the delta sequence the reader reassembles to the LLM output', async () => {
      const job = makeJob();
      const { conversationId } = job.data;

      await createTestChat({
        sessionId: conversationId,
        userId: job.data.userId,
      });
      await processor(job);

      // Read back through the reader's pure parser: the coalesced delta(s) must
      // reassemble to exactly the mocked stream, closed by a done terminal.
      const events = await readStreamEvents(conversationId);
      const text = events
        .filter((e) => e.type === 'delta')
        .map((e) => e.chunk)
        .join('');
      expect(text).toBe('Test response from mocked LLM.');
      expect(events.at(-1)?.type).toBe('done');
    });

    it('carries the persisted assistant Message id on done (no recall scan)', async () => {
      const job = makeJob();
      const { conversationId, userId } = job.data;

      await createTestChat({ sessionId: conversationId, userId });
      await processor(job);

      // The id round-trip: the id persist minted (and the writer put on `done`)
      // is exactly the id the chat-memory recall reports for the Message — so a
      // terminal no longer depends on scanning the whole thread.
      const events = await readStreamEvents(conversationId);
      const terminal = events.at(-1);
      if (terminal?.type !== 'done') {
        throw new Error(`expected a done terminal, got ${terminal?.type}`);
      }

      const { messages } = await memory.recall({
        threadId: conversationId,
        resourceId: userId,
        perPage: false,
      });
      const assistant = messages.filter((m) => m.role === 'assistant');
      expect(assistant).toHaveLength(1);
      expect(assistant[0]?.id).toBe(terminal.messageId);
    });

    it('persists the assistant Message so chat.get returns it', async () => {
      const job = makeJob();
      const { conversationId, userId } = job.data;

      await createTestChat({ sessionId: conversationId, userId });
      await processor(job);

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
      await processor(job);

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

      await processor(job);

      const lock = await redis.get(chatInflightKey(conversationId));
      expect(lock).toBeNull();
    });

    it('sets the thread title on the first Turn', async () => {
      const job = makeJob({ query: 'What is the capital of France?' });
      const { conversationId, userId } = job.data;

      await createTestChat({ sessionId: conversationId, userId });
      await processor(job);

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

      await processor(job);

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

      await processor(job);

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

      await processor(job);

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

      await processor(job);

      const guardValue = await redis.get(chatRefundedKey(turnId));
      expect(guardValue).toBe('1');
    });

    it('refunds the Turn credit through the injected provider on error', async () => {
      const job = makeJob({ tier: 'Standard' });
      const { conversationId, userId, tier } = job.data;

      await createTestChat({ sessionId: conversationId, userId });
      vi.spyOn(chatAgent, 'stream').mockResolvedValue(
        throwingAgentStream([], new Error('LLM failed')),
      );

      await processor(job);

      // The credit-back crosses the injected EntitlementsProvider seam — the
      // worker refunds exactly the per-Turn charge for the job's userId + tier.
      expect(refundCalls).toEqual([{ userId, tier, amount: CREDITS_PER_TURN }]);
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
      await expect(processor(job)).resolves.not.toThrow();
      // The guard short-circuits before the provider seam — no refund crossed.
      expect(refundCalls).toEqual([]);
    });
  });
});
