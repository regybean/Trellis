import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod/v4';

import { shouldSkipEnvValidation } from '@acme/env';

const skipValidation = shouldSkipEnvValidation();

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
