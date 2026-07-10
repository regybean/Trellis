import type { Job } from 'bullmq';

import { logger } from '@acme/logger';
import { memory } from '@acme/rag';
import { redis } from '@acme/redis';
import { credits } from '@acme/subscriptions';

import type { GenerationJob } from './chat-queue';
import {
  chatAbortKey,
  chatInflightKey,
  chatRefundedKey,
  chatStreamKey,
} from '../chat-keys';
import { chatAgent } from './chat-agent';

// Stream TTLs (seconds). The safety TTL prevents a crashed-worker stream living
// forever. The post-terminal TTL is shortened right after a terminal is written,
// then the key is proactively deleted — the TTL is purely a safety net.
const STREAM_SAFETY_TTL = 600;
const STREAM_POST_TERMINAL_TTL = 60;

async function refundIfNotAlready(
  userId: string,
  tier: GenerationJob['tier'],
  turnId: string,
) {
  // SET NX: only the first caller for this turnId performs the refund.
  const guardKey = chatRefundedKey(turnId);
  const acquired = await redis.set(guardKey, '1', { NX: true });
  if (!acquired) return false;
  await credits.refund(userId, tier, 1);
  return true;
}

async function releaseStream(conversationId: string, turnId: string) {
  const streamKey = chatStreamKey(conversationId);
  const inflightKey = chatInflightKey(conversationId);
  // Shorten TTL before proactive delete — safety net if del fails.
  await redis.expire(streamKey, STREAM_POST_TERMINAL_TTL);
  await redis.del(streamKey);
  // Release the lock only if it still points to this Turn (a new turn may have
  // already acquired it).
  const lockValue = await redis.get(inflightKey);
  if (lockValue === turnId) {
    await redis.del(inflightKey);
  }
}

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

async function handleAbort(
  conversationId: string,
  turnId: string,
  userId: string,
  accumulated: string,
) {
  const streamKey = chatStreamKey(conversationId);
  logger.info({ conversationId, turnId }, 'generation worker: abort received');

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

  await releaseStream(conversationId, turnId);
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

    for await (const chunk of result.textStream) {
      const abortSignal = await redis.get(abortKey);
      if (abortSignal === turnId) {
        await handleAbort(conversationId, turnId, userId, accumulated);
        return;
      }

      accumulated += chunk;
      await redis.xAdd(streamKey, '*', { chunk });

      // Set safety TTL on the first write so a crashed worker doesn't leave
      // a dangling stream key.
      if (!safetyTtlSet) {
        await redis.expire(streamKey, STREAM_SAFETY_TTL);
        safetyTtlSet = true;
      }
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
    await refundIfNotAlready(userId, tier, turnId);
  } finally {
    await releaseStream(conversationId, turnId);
  }
}
