import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod/v4';

import { shouldSkipEnvValidation } from '@acme/env';

const skipValidation = shouldSkipEnvValidation();

function queueEnv() {
  return createEnv({
    shared: {
      NODE_ENV: z
        .enum(['development', 'production', 'test'])
        .default('development'),
      // App identity — namespaces the BullMQ key prefix so each app owns an
      // isolated `generation` queue on the shared Redis. Mirrors the same
      // partitioning @acme/redis applies to its key prefix and @acme/rag to
      // the Postgres schema; without it, one app's worker would drain another
      // app's jobs. Same Postgres-identifier shape as those consumers.
      NEXT_PUBLIC_WEBAPP: z
        .string()
        .regex(
          /^[a-z][a-z0-9_]*$/,
          'NEXT_PUBLIC_WEBAPP must be a valid Postgres identifier: lowercase letter then lowercase/digits/underscores',
        ),
    },
    server: {
      REDIS_URL: z.url(),
    },
    client: {},
    runtimeEnv: {
      NEXT_PUBLIC_WEBAPP: process.env.NEXT_PUBLIC_WEBAPP,
      NODE_ENV: process.env.NODE_ENV,
      REDIS_URL: process.env.REDIS_URL,
    },
    skipValidation,
  });
}

export const env = queueEnv();
