import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod/v4';

import { billingEnv } from '@acme/billing/env';
import { chatEnv } from '@acme/chat/env';
import { shouldSkipEnvValidation } from '@acme/env';
import { ingestEnv } from '@acme/ingest/env';

const skipValidation = shouldSkipEnvValidation();

export const env = createEnv({
  extends: [chatEnv(), ingestEnv(), billingEnv()],
  server: {},
  client: {
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string(),
  },
  runtimeEnv: {
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  },
  skipValidation,
});
