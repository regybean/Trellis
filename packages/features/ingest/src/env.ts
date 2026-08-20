import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod/v4';

import { serverConfigContext } from '@acme/config';
import { shouldSkipEnvValidation } from '@acme/env';

const skipValidation = shouldSkipEnvValidation();

/**
 * The config-as-code deploy-target selector (ADR 0026), resolved at this slice's
 * sanctioned `process.env` edge and threaded into `ingestConfig` where the S3
 * client is built (`utils/s3-client.ts`). Mirrors the app's `env.ts`; keeps
 * `config.ts` pure.
 *
 * The same edge samples the **override** bag (ADR 0033): every one of this
 * slice's config values can be retuned by a same-name environment variable at
 * runtime, so nothing here has to be re-authored per deploy.
 */
export const configContext = serverConfigContext(process.env);

export function ingestEnv() {
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
    // The S3 region, endpoint and bucket are config-as-code now (`config.ts`,
    // ADR 0026). Only the raw AWS credentials remain here (secrets).
    server: {
      AWS_ACCESS_KEY_ID: z.string(),
      AWS_SECRET_ACCESS_KEY: z.string(),
    },
    client: {},
    runtimeEnv: {
      NODE_ENV: process.env.NODE_ENV,
      NEXT_PUBLIC_WEBAPP: process.env.NEXT_PUBLIC_WEBAPP,
      AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
      AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    },
    skipValidation,
  });
}

export const env = ingestEnv();
