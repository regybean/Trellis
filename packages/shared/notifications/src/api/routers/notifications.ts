import { tracked } from '@trpc/server';
import { z } from 'zod';

import { logger } from '@acme/logger';

import { tailNotifications } from '../services/notification-stream';
import { createTRPCRouter, protectedProcedure } from '../trpc';

// Input to the pure `stream` reader. `lastEventId` is populated by tRPC from the
// SSE `Last-Event-ID` header on a transient reconnect (mirrors chat's
// `StreamReaderRequest`); a fresh connect omits it and the reader tails from now.
const streamInput = z.object({ lastEventId: z.string().nullish() });

export const notificationsRouter = createTRPCRouter({
  // Cross-cutting per-user subscription — the first in the repo. `protectedProcedure`
  // (all authenticated users), NOT `adminProcedure`: any user can receive a
  // notification. `userId` is read from `ctx.session.user` (never a client input),
  // so a client can only ever tail its own stream. Re-emits each entry via tRPC
  // v11 `tracked(entryId, notification)`, so the entry id becomes the SSE
  // `Last-Event-ID`. Never self-closes — only client abort ends it.
  stream: protectedProcedure.input(streamInput).subscription(async function* ({
    ctx,
    input,
    signal,
  }) {
    const userId = ctx.session.user.id;
    logger.info(
      { userId, lastEventId: input.lastEventId },
      'notifications.stream: reader attached',
    );

    // The seed (tail-from-now vs resume) is captured eagerly at attach; the tail
    // is the shared durable-stream primitive. `event` is the decoded envelope.
    const notifications = await tailNotifications(
      userId,
      input.lastEventId ?? null,
      signal,
    );
    for await (const { id, event } of notifications) {
      yield tracked(id, event);
    }
  }),
});
