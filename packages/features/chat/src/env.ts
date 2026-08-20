import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod/v4';

import { serverConfigContext } from '@acme/config';
import { shouldSkipEnvValidation } from '@acme/env';

const skipValidation = shouldSkipEnvValidation();

/**
 * The config-as-code deploy-target selector (ADR 0026), resolved at this slice's
 * sanctioned `process.env` edge and threaded into `chatConfig` where the
 * `api/services` layer builds its config server-side. Mirrors the app's `env.ts`;
 * keeps `config.ts` pure.
 *
 * The same edge samples the **override** bag (ADR 0033): every one of this
 * slice's config values can be retuned by a same-name environment variable at
 * runtime, so nothing here has to be re-authored per deploy.
 */
export const configContext = serverConfigContext(process.env);

export function chatEnv() {
  return createEnv({
    shared: {
      NODE_ENV: z
        .enum(['development', 'production', 'test'])
        .default('development'),
      // Per-app identity — Postgres/pgvector schema + Redis prefix. Must be a
      // valid Postgres identifier: lowercase letter then lowercase/digits/underscores.
      NEXT_PUBLIC_WEBAPP: z
        .string()
        .regex(
          /^[a-z][a-z0-9_]*$/,
          'NEXT_PUBLIC_WEBAPP must be a valid Postgres identifier: lowercase letter then lowercase/digits/underscores',
        ),
    },
    client: {
      // Composed into the query persister's `buster` (with the app-supplied
      // `scopeKey`) so a deploy that changes the persisted data shape discards
      // every prior snapshot on restore. Optional: apps that don't set it get a
      // stable default, which simply never busts on version alone.
      NEXT_PUBLIC_APP_VERSION: z.string().default('0.0.0'),
    },
    runtimeEnv: {
      NODE_ENV: process.env.NODE_ENV,
      NEXT_PUBLIC_WEBAPP: process.env.NEXT_PUBLIC_WEBAPP,
      NEXT_PUBLIC_APP_VERSION: process.env.NEXT_PUBLIC_APP_VERSION,
    },
    skipValidation,
  });
}

export const env = chatEnv();
