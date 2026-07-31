import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

import { resolveAppEnv } from '@acme/config';
import { shouldSkipEnvValidation } from '@acme/env';

const skipValidation = shouldSkipEnvValidation();

/**
 * The config-as-code deploy-target selector (ADR 0026), resolved at this
 * package's sanctioned `process.env` edge and threaded into `notificationsConfig`
 * where the server (`publish` / reader) builds its config. Mirrors chat's
 * `env.ts`; keeps `config.ts` pure. On the client `process.env.APP_ENV` is
 * undefined and resolves to the base profile — the client never reads config.
 */
export const appEnv = resolveAppEnv(process.env.APP_ENV);

export function notificationsEnv() {
  return createEnv({
    shared: {
      NODE_ENV: z
        .enum(['development', 'production', 'test'])
        .default('development'),
    },
    runtimeEnv: {
      NODE_ENV: process.env.NODE_ENV,
    },
    skipValidation,
  });
}

export const env = notificationsEnv();
