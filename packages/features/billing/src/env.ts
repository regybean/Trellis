import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod/v4';

import { resolveAppEnv } from '@acme/config';
import { shouldSkipEnvValidation } from '@acme/env';

const skipValidation = shouldSkipEnvValidation();

/**
 * The config-as-code deploy-target selector (ADR 0026), resolved at this slice's
 * sanctioned `process.env` edge and threaded into `billingConfig` where
 * the SDK connection + checkout paths are read (`utils/stripe-client.ts`,
 * `utils/stripe-checkout.ts`). Mirrors `ingest`'s env edge; keeps `config.ts` pure.
 */
export const appEnv = resolveAppEnv(process.env.APP_ENV);

export function billingEnv() {
  return createEnv({
    shared: {
      NODE_ENV: z
        .enum(['development', 'production', 'test'])
        .default('development'),
    },
    // The localstripe switch (was `STRIPE_API_BASE`) and the checkout redirect
    // targets (were `STRIPE_SUCCESS_URL`/`STRIPE_CANCEL_URL`) are config-as-code
    // now (`billingConfig`, ADR 0026 follow-up). Only the Stripe secrets
    // remain here.
    server: {
      STRIPE_SECRET_KEY: z.string(),
      STRIPE_WEBHOOK_SECRET: z.string(),
    },
    runtimeEnv: {
      NODE_ENV: process.env.NODE_ENV,
      STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
      STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    },
    skipValidation,
  });
}

export const env = billingEnv();
