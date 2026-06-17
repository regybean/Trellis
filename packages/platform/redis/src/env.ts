import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod/v4';

function redisEnv() {
  return createEnv({
    shared: {
      NODE_ENV: z
        .enum(['development', 'production', 'test'])
        .default('development'),
      // App identity — partitions every shared datastore per app. Mirrors the
      // per-app Postgres schema (see @acme/rag env). Drives the Redis key
      // prefix so the two apps never collide on one shared Redis instance.
      NEXT_PUBLIC_WEBAPP: z.string().nonempty(),
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
    skipValidation:
      !!process.env.CI ||
      process.env.npm_lifecycle_event === 'lint' ||
      process.env.NEXT_PHASE === 'phase-production-build',
  });
}
export const env = redisEnv();
