import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod/v4';

import { resolveAppEnv, webappSchema, withProfiles } from '@acme/env';

/** The deploy-target selector, resolved at this slice's `process.env` edge. */
const appEnv = resolveAppEnv(process.env.APP_ENV);

/**
 * Queue's environment (@acme/env ADR 0001). Selectors only — this slice authors no tunables
 * of its own; the BullMQ retention counts belong to the features that enqueue.
 * Both keys stay written longhand in `runtimeEnv`: they are the ones a bundler
 * inlines textually, and an index access is invisible to that.
 */
function queueEnv() {
  return createEnv({
    clientPrefix: 'NEXT_PUBLIC_',
    client: {},
    shared: {
      NODE_ENV: z.enum(['development', 'production', 'test']),
      // App identity — namespaces the BullMQ key prefix so each app owns an
      // isolated `generation` queue on the shared Redis. Mirrors the same
      // partitioning @acme/redis applies to its key prefix and @acme/rag to
      // the Postgres schema; without it, one app's worker would drain another
      // app's jobs. Same `webappSchema` as those consumers.
      NEXT_PUBLIC_WEBAPP: webappSchema,
    },
    createFinalSchema: (shape) =>
      withProfiles(shape, appEnv, { default: { NODE_ENV: 'development' } }),
    runtimeEnv: {
      NEXT_PUBLIC_WEBAPP: process.env.NEXT_PUBLIC_WEBAPP,
      NODE_ENV: process.env.NODE_ENV,
    },
    emptyStringAsUndefined: true,
  });
}

export const env = queueEnv();
