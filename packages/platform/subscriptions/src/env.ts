import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod/v4';

import { resolveAppEnv } from '@acme/config';
import { shouldSkipEnvValidation } from '@acme/env';

const skipValidation = shouldSkipEnvValidation();

/**
 * The config-as-code deploy-target selector (ADR 0026), resolved at this slice's
 * sanctioned `process.env` edge and threaded into `subscriptionsConfig` where the
 * slice builds its config server-side (`credit-policy.ts`). Mirrors the app's
 * `env.ts` read; keeps `config.ts` pure.
 */
export const appEnv = resolveAppEnv(process.env.APP_ENV);

export const env = createEnv({
  client: {
    NEXT_PUBLIC_STRIPE_STANDARD_PLAN_ID: z.string(),
    NEXT_PUBLIC_STRIPE_PRO_PLAN_ID: z.string(),
  },
  runtimeEnv: {
    NEXT_PUBLIC_STRIPE_STANDARD_PLAN_ID:
      process.env.NEXT_PUBLIC_STRIPE_STANDARD_PLAN_ID,
    NEXT_PUBLIC_STRIPE_PRO_PLAN_ID: process.env.NEXT_PUBLIC_STRIPE_PRO_PLAN_ID,
  },
  skipValidation,
});
