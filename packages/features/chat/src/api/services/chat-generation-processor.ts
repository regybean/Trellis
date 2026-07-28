import type { EntitlementsProvider } from '@acme/entitlements';
import type { Job } from '@acme/queue';
import { logger } from '@acme/logger';
import { redis } from '@acme/redis';

import type { GenerationJob } from './chat-queue';
import type { TurnTerminalKind } from './chat-turn-lifecycle';
import { chatConfig } from '../../config';
import { appEnv } from '../../env';
import { chatStreamKey } from '../chat-keys';
import { chatAgent } from './chat-agent';
import {
  generateThreadTitle,
  latestAssistantMessageId,
  persistAssistantMessage,
} from './chat-memory';
import {
  isTurnAborted,
  refundTurnCredits,
  settleTurn,
} from './chat-turn-lifecycle';

// Safety TTL (`config.STREAM_SAFETY_TTL`, seconds) set on the Stream's first
// write so a crashed worker cannot leave a dangling key. The lock/abort TTLs and
// the terminal teardown (`settleTurn`) live in chat-turn-lifecycle, the one home
// for the Turn control plane. Config-as-code (ADR 0026).
const config = chatConfig({ appEnv, isServer: true });

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

// Factory for the BullMQ job processor. It closes over an injected
// `EntitlementsProvider` so the request-less worker refunds through the SAME
// seam the request path does (ADR 0006 / ADR 0010): each app's worker entrypoint
// (apps/*/worker.ts) injects the exact provider its route handler injects — full
// apps `subscriptionsEntitlements`, slim apps `unlimitedEntitlements`. Ownership
// was asserted by chat.send before enqueueing; userId from the job payload
// stamps resourceId for Mastra. See ADR 0004.
export function createChatGenerationProcessor(
  entitlements: EntitlementsProvider,
) {
  return async function chatGenerationProcessor(job: Job<GenerationJob>) {
    return runGenerationTurn(entitlements, job);
  };
}

async function runGenerationTurn(
  entitlements: EntitlementsProvider,
  job: Job<GenerationJob>,
) {
  const { conversationId, turnId, userId, tier, query } = job.data;
  const streamKey = chatStreamKey(conversationId);
  let safetyTtlSet = false;
  // The terminal this Turn settled on — the worker names it for `settleTurn` in
  // the `finally`. Defaults to `error` (the catch path); the success and abort
  // paths overwrite it. The teardown is uniform across the three, so a title
  // failure after `done` flips it to `error` with no observable difference.
  let terminal: TurnTerminalKind = 'error';

  logger.info({ conversationId, turnId }, 'generation worker: starting');

  try {
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
    const aborted = () => isTurnAborted({ conversationId, turnId });

    for await (const chunk of result.textStream) {
      // Accumulate and publish the delta first, THEN honour an abort — so the
      // chunk in flight is included in the persisted partial rather than
      // discarded. Checking before the append would drop the current token.
      accumulated += chunk;
      await redis.xAdd(streamKey, '*', { chunk });

      // Set safety TTL on the first write so a crashed worker doesn't leave
      // a dangling stream key.
      if (!safetyTtlSet) {
        await redis.expire(streamKey, config.STREAM_SAFETY_TTL);
        safetyTtlSet = true;
      }

      if (await aborted()) {
        await handleAbort(conversationId, userId, accumulated);
        terminal = 'cancelled';
        return;
      }
    }

    // An abort that arrived before/around an empty stream is caught here, so it
    // yields a `cancelled` terminal (empty ⇒ no messageId) rather than `done`.
    if (await aborted()) {
      await handleAbort(conversationId, userId, accumulated);
      terminal = 'cancelled';
      return;
    }

    // Clean completion: persist assistant message then emit done terminal.
    await persistAssistantMessage(conversationId, userId, accumulated);
    const messageId = await latestAssistantMessageId(conversationId, userId);
    await redis.xAdd(streamKey, '*', {
      type: 'done',
      ...(messageId ? { messageId } : {}),
    });
    terminal = 'done';

    // On the first Turn, generate the thread title from the initial query. The
    // adapter owns the first-Turn check + Mastra write.
    await generateThreadTitle(conversationId, query);

    logger.info({ conversationId, turnId }, 'generation worker: done');
  } catch (error) {
    logger.error(
      { err: error, conversationId, turnId },
      'generation worker: error',
    );

    if (!safetyTtlSet) {
      await redis.expire(
        chatStreamKey(conversationId),
        config.STREAM_SAFETY_TTL,
      );
    }
    await redis.xAdd(chatStreamKey(conversationId), '*', { type: 'error' });
    await refundTurnCredits(
      (uid, creditTier, amount) => entitlements.refund(uid, creditTier, amount),
      userId,
      tier,
      turnId,
    );
    terminal = 'error';
  } finally {
    await settleTurn(terminal, { conversationId, turnId });
  }
}
