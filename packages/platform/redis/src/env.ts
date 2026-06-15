import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod/v4';

function redisEnv() {
  return createEnv({
    shared: {
      NODE_ENV: z
        .enum(['development', 'production', 'test'])
        .default('development'),
    },
    server: {
      REDIS_URL: z.url(),
    },
    client: {},
    runtimeEnv: {
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
