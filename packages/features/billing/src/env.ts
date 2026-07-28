import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod/v4';

import { shouldSkipEnvValidation } from '@acme/env';

const skipValidation = shouldSkipEnvValidation();

export function billingEnv() {
  return createEnv({
    shared: {
      NODE_ENV: z
        .enum(['development', 'production', 'test'])
        .default('development'),
    },
    server: {
      // Dev-only: point the Stripe SDK at a localstripe server instead of the
      // real Stripe API. Unset in prod → real Stripe. See docs/adr/0003. A
      // pre-composition infra switch (read by the `getStripe` SDK singleton and
      // the seed script), so it stays in env rather than moving to config.
      STRIPE_API_BASE: z.url().optional(),
      STRIPE_SECRET_KEY: z.string(),
      STRIPE_WEBHOOK_SECRET: z.string(),
      // Server-only checkout redirect targets, injected per deploy (no committed
      // staging/production values) — stay in env (ADR 0026). The non-sensitive,
      // per-env-duplicated client values live in `./config` (`billingConfig`).
      STRIPE_SUCCESS_URL: z.url(),
      STRIPE_CANCEL_URL: z.url(),
    },
    runtimeEnv: {
      NODE_ENV: process.env.NODE_ENV,
      STRIPE_CANCEL_URL: process.env.STRIPE_CANCEL_URL,
      STRIPE_SUCCESS_URL: process.env.STRIPE_SUCCESS_URL,
      STRIPE_API_BASE: process.env.STRIPE_API_BASE,
      STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
      STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    },
    skipValidation,
  });
}

export const env = billingEnv();
