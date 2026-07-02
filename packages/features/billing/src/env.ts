import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod/v4';

const skipValidation =
  !!process.env.CI ||
  process.env.npm_lifecycle_event === 'lint' ||
  process.env.NEXT_PHASE === 'phase-production-build';

export function billingEnv() {
  return createEnv({
    shared: {
      NODE_ENV: z
        .enum(['development', 'production', 'test'])
        .default('development'),
    },
    server: {
      // Dev-only: point the Stripe SDK at a localstripe server instead of the
      // real Stripe API. Unset in prod → real Stripe. See docs/adr/0003.
      STRIPE_API_BASE: z.url().optional(),
      STRIPE_SECRET_KEY: z.string(),
      STRIPE_WEBHOOK_SECRET: z.string(),
      STRIPE_SUCCESS_URL: z.url(),
      STRIPE_CANCEL_URL: z.url(),
      REDIS_URL: z.url(),
      DB_HOST: z.string().nonempty(),
      DB_PORT: z.coerce.number(),
      DB_USER: z.string().nonempty(),
      DB_PASSWORD: z.string().nonempty(),
      DB_NAME: z.string().nonempty(),
    },
    client: {
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string(),
      NEXT_PUBLIC_STRIPE_MANAGE_BILLING_URL: z.url(),
      NEXT_PUBLIC_STRIPE_PRO_PLAN_ID: z.string(),
      NEXT_PUBLIC_STRIPE_STANDARD_PLAN_ID: z.string(),
    },
    runtimeEnv: {
      NODE_ENV: process.env.NODE_ENV,
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:
        process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
      NEXT_PUBLIC_STRIPE_MANAGE_BILLING_URL:
        process.env.NEXT_PUBLIC_STRIPE_MANAGE_BILLING_URL,
      STRIPE_CANCEL_URL: process.env.STRIPE_CANCEL_URL,
      STRIPE_SUCCESS_URL: process.env.STRIPE_SUCCESS_URL,
      NEXT_PUBLIC_STRIPE_PRO_PLAN_ID:
        process.env.NEXT_PUBLIC_STRIPE_PRO_PLAN_ID,
      NEXT_PUBLIC_STRIPE_STANDARD_PLAN_ID:
        process.env.NEXT_PUBLIC_STRIPE_STANDARD_PLAN_ID,
      STRIPE_API_BASE: process.env.STRIPE_API_BASE,
      STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
      STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
      REDIS_URL: process.env.REDIS_URL,
      DB_HOST: process.env.DB_HOST,
      DB_PORT: process.env.DB_PORT,
      DB_USER: process.env.DB_USER,
      DB_PASSWORD: process.env.DB_PASSWORD,
      DB_NAME: process.env.DB_NAME,
    },
    skipValidation,
  });
}

export const env = billingEnv();
