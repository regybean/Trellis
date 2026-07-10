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
    },
    server: {
      REDIS_URL: z.url(),
    },
    client: {},
    runtimeEnv: {
      NODE_ENV: process.env.NODE_ENV,
      REDIS_URL: process.env.REDIS_URL,
    },
    skipValidation,
  });
}

export const env = queueEnv();
