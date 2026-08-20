import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

import { serverConfigContext } from '@acme/config';
import { shouldSkipEnvValidation } from '@acme/env';

const skipValidation = shouldSkipEnvValidation();

/**
 * The config-as-code deploy-target selector (ADR 0026), resolved at this
 * package's sanctioned `process.env` edge and threaded into `notificationsConfig`
 * where the server (`publish` / reader) builds its config. Mirrors chat's
 * `env.ts`; keeps `config.ts` pure. On the client `process.env.APP_ENV` is
 * undefined and resolves to the base profile — the client never reads config.
 *
 * The same edge samples the **override** bag (ADR 0033): every one of this
 * slice's config values can be retuned by a same-name environment variable at
 * runtime, so nothing here has to be re-authored per deploy.
 */
export const configContext = serverConfigContext(process.env);

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
