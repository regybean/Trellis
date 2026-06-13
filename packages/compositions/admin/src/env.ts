import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod/v4';

export function adminEnv() {
  return createEnv({
    shared: {
      NODE_ENV: z
        .enum(['development', 'production', 'test'])
        .default('development'),
    },
    server: {
      REDIS_URL: z.url(),
    },
    client: {
      NEXT_PUBLIC_STRIPE_STANDARD_PLAN_ID: z.string(),
      NEXT_PUBLIC_STRIPE_PRO_PLAN_ID: z.string(),
    },
    runtimeEnv: {
      NODE_ENV: process.env.NODE_ENV,
      NEXT_PUBLIC_STRIPE_PRO_PLAN_ID:
        process.env.NEXT_PUBLIC_STRIPE_PRO_PLAN_ID,
      NEXT_PUBLIC_STRIPE_STANDARD_PLAN_ID:
        process.env.NEXT_PUBLIC_STRIPE_STANDARD_PLAN_ID,
      REDIS_URL: process.env.REDIS_URL,
    },
    skipValidation:
      !!process.env.CI || process.env.npm_lifecycle_event === 'lint',
  });
}

export const env = adminEnv();
