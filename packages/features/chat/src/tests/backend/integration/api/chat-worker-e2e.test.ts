/**
 * T6 end-to-end smoke test — the durable-stream round trip through a *real*
 * BullMQ worker.
 *
 * Where `chat-generation-processor.test.ts` calls the processor directly, this
 * test drains it through `createWorker` — exactly the wiring each app's
 * `apps/<app>/worker.ts` entry point performs. It proves the whole chain the ticket
 * (#50) calls for:
 *
 *   chat.send → job enqueued → worker drains it → deltas published to the Redis
 *   Stream → chat.stream reader re-emits them → `done` terminal with messageId →
 *   chat.get returns the persisted assistant Message.
 *
 * The LLM is stubbed at the `chatAgent` boundary by the shared backend setup
 * (`setup.ts`), so the assistant text is deterministic. Real Postgres + Redis
 * come from testcontainers.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createWorker, QUEUE_NAMES } from '@acme/queue';

import type { GenerationJob } from '../../../../api/services/chat-queue';
import type { TestContextOptions } from '../../utils/test-context';
import { appRouter } from '../../../../api/root';
import { chatGenerationProcessor } from '../../../../api/services/chat-generation-processor';
import { _generationQueue } from '../../../../api/services/chat-queue';
import { tailChatStream } from '../../../../api/services/chat-stream-reader';
import { createTestSessionId, createTestUserId } from '../../utils/fixtures';
import { createTestContext } from '../../utils/test-context';

// The exact text setup.ts's default chatAgent stub yields, reassembled — the
// deltas that must survive the trip through the queue, the worker and the Stream.
const EXPECTED_TEXT = 'Test response from mocked LLM.';

const baseCredits = {
  remaining: 100,
  limit: 100,
  resetAt: Date.now() + 86_400_000,
};

function createCaller(opts: TestContextOptions) {
  return appRouter.createCaller(createTestContext(opts));
}

// Drain the pure reader to completion. Once the worker has finalised the Turn
// the In-flight lock is released, so the reader emits what the Stream holds and
// closes (the terminal shortens the Stream to a 60s TTL rather than deleting it).
async function drainReader(conversationId: string) {
  const out = [];
  for await (const entry of tailChatStream(conversationId, null)) {
    out.push(entry);
  }
  return out;
}

// One shared worker for the suite, mirroring apps/*/worker.ts: same queue name,
// same processor, same @acme/queue connection + per-app prefix.
let worker: ReturnType<typeof createWorker<GenerationJob>>;

describe('generation worker (end-to-end via BullMQ)', () => {
  beforeAll(() => {
    worker = createWorker<GenerationJob>(
      QUEUE_NAMES.GENERATION,
      chatGenerationProcessor,
    );
  });

  afterAll(async () => {
    await worker.close();
  });

  // Clear any jobs a prior test left in the queue (setup.ts's cleanup flushes
  // the facade Redis DB, but the BullMQ connection is a separate logical DB).
  beforeEach(async () => {
    await _generationQueue.obliterate({ force: true });
  });

  it('drains a sent Turn: deltas + done terminal, then the assistant Message persists', async () => {
    const userId = createTestUserId();
    const conversationId = createTestSessionId();
    const turnId = crypto.randomUUID();
    const caller = createCaller({
      userId,
      role: 'user',
      tier: 'Basic',
      credits: baseCredits,
    });

    // Resolves once the processor promise settles — its `finally` (lock release,
    // post-terminal TTL) has already run by the time BullMQ fires `completed`.
    const drained = new Promise<void>((resolve, reject) => {
      worker.once('completed', () => resolve());
      worker.once('failed', (_job, err) => reject(err));
    });

    const result = await caller.chat.send({
      query: 'Hello there',
      conversationId,
      turnId,
    });
    expect(result).toEqual({ status: 'accepted', turnId });

    await drained;

    // The reader re-emits every delta in order, then the done terminal.
    const emitted = await drainReader(conversationId);
    const events = emitted.map((e) => e.event);

    const chunks = events.filter((e) => e.type === 'delta').map((e) => e.chunk);
    expect(chunks.join('')).toBe(EXPECTED_TEXT);

    const terminal = events.at(-1);
    if (terminal?.type !== 'done') {
      throw new Error(`expected a done terminal, got ${terminal?.type}`);
    }
    // done carries the persisted assistant Message's id (the handle other
    // features key off).
    expect(terminal.messageId).toBeTruthy();

    // chat.get returns the assistant Message the worker persisted on terminal.
    const messages = await caller.chat.get({ sessionId: conversationId });
    const assistant = messages.filter((m) => m.role === 'assistant');
    expect(assistant).toHaveLength(1);
    expect(assistant[0]?.text).toBe(EXPECTED_TEXT);
  }, 30_000);
});
