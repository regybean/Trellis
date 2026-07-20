import type { Job } from '@acme/queue';
import { logger } from '@acme/logger';
import { memory } from '@acme/rag';
import { redis } from '@acme/redis';

import type { GenerationJob } from './chat-queue';
import { chatAbortKey, chatStreamKey } from '../chat-keys';
import { chatAgent } from './chat-agent';
import { finalizeTurn, refundTurnCredits } from './chat-turn-lifecycle';

// Safety TTL (seconds) set on the Stream's first write so a crashed worker
// cannot leave a dangling key. The lock/abort TTLs and the post-terminal
// teardown live in chat-turn-lifecycle, the one home for the Turn control plane.
const STREAM_SAFETY_TTL = 600;

async function persistAssistantMessage(
  conversationId: string,
  userId: string,
  text: string,
) {
  await memory.saveMessages({
    messages: [
      {
        id: crypto.randomUUID(),
        role: 'assistant' as const,
        createdAt: new Date(),
        threadId: conversationId,
        resourceId: userId,
        content: {
          format: 2,
          parts: [{ type: 'text', text }],
          content: text,
        },
      },
    ],
  });
}

async function latestAssistantMessageId(
  conversationId: string,
  userId: string,
) {
  const { messages } = await memory.recall({
    threadId: conversationId,
    resourceId: userId,
    perPage: false,
  });
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === 'assistant') return m.id;
  }
  return null;
}

// Persist any non-empty partial and emit the `cancelled` terminal. Teardown
// (lock release, post-terminal TTL) is left to the processor's `finally`, which
// runs on the abort `return` path too.
async function handleAbort(
  conversationId: string,
  userId: string,
  accumulated: string,
) {
  const streamKey = chatStreamKey(conversationId);
  logger.info({ conversationId }, 'generation worker: abort received');

  if (accumulated) {
    await persistAssistantMessage(conversationId, userId, accumulated);
    const messageId = await latestAssistantMessageId(conversationId, userId);
    await redis.xAdd(streamKey, '*', {
      type: 'cancelled',
      ...(messageId ? { messageId } : {}),
    });
  } else {
    await redis.xAdd(streamKey, '*', { type: 'cancelled' });
  }
}

// BullMQ job processor — called by the worker entrypoint in each app
// (apps/*/worker.ts). Ownership was asserted by chat.send before enqueueing;
// userId from the job payload stamps resourceId for Mastra. See ADR 0004.
export async function chatGenerationProcessor(job: Job<GenerationJob>) {
  const { conversationId, turnId, userId, tier, query } = job.data;
  const streamKey = chatStreamKey(conversationId);
  const abortKey = chatAbortKey(conversationId);
  let safetyTtlSet = false;

  logger.info({ conversationId, turnId }, 'generation worker: starting');

  try {
    const thread = await memory.getThreadById({ threadId: conversationId });
    const isFirstTurn = !thread?.title || thread.title === 'New conversation';

    // readOnly: true — Mastra recalls context but does NOT auto-persist the
    // user or assistant turn. We persist the assistant message explicitly on
    // terminal so we control the messageId and persistence timing.
    const result = await chatAgent.stream(query, {
      memory: {
        thread: conversationId,
        resource: userId,
        options: { readOnly: true },
      },
    });

    let accumulated = '';
    const aborted = async () => (await redis.get(abortKey)) === turnId;

    for await (const chunk of result.textStream) {
      // Accumulate and publish the delta first, THEN honour an abort — so the
      // chunk in flight is included in the persisted partial rather than
      // discarded. Checking before the append would drop the current token.
      accumulated += chunk;
      await redis.xAdd(streamKey, '*', { chunk });

      // Set safety TTL on the first write so a crashed worker doesn't leave
      // a dangling stream key.
      if (!safetyTtlSet) {
        await redis.expire(streamKey, STREAM_SAFETY_TTL);
        safetyTtlSet = true;
      }

      if (await aborted()) {
        await handleAbort(conversationId, userId, accumulated);
        return;
      }
    }

    // An abort that arrived before/around an empty stream is caught here, so it
    // yields a `cancelled` terminal (empty ⇒ no messageId) rather than `done`.
    if (await aborted()) {
      await handleAbort(conversationId, userId, accumulated);
      return;
    }

    // Clean completion: persist assistant message then emit done terminal.
    await persistAssistantMessage(conversationId, userId, accumulated);
    const messageId = await latestAssistantMessageId(conversationId, userId);
    await redis.xAdd(streamKey, '*', {
      type: 'done',
      ...(messageId ? { messageId } : {}),
    });

    // On the first Turn, update the thread title from the initial query.
    if (isFirstTurn) {
      await memory.updateThread({
        id: conversationId,
        title: query.slice(0, 80),
        metadata: thread?.metadata ?? {},
      });
    }

    logger.info({ conversationId, turnId }, 'generation worker: done');
  } catch (error) {
    logger.error(
      { err: error, conversationId, turnId },
      'generation worker: error',
    );

    if (!safetyTtlSet) {
      await redis.expire(chatStreamKey(conversationId), STREAM_SAFETY_TTL);
    }
    await redis.xAdd(chatStreamKey(conversationId), '*', { type: 'error' });
    await refundTurnCredits(userId, tier, turnId);
  } finally {
    await finalizeTurn(conversationId, turnId);
  }
}
