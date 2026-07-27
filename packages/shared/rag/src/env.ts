import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod/v4';

import { resolveAppEnv } from '@acme/config';
import { shouldSkipEnvValidation } from '@acme/env';

const skipValidation = shouldSkipEnvValidation();

/**
 * The config-as-code deploy-target selector (ADR 0026), resolved at this slice's
 * sanctioned `process.env` edge and threaded into the config factories this slice
 * builds server-side (e.g. `modelsConfig` for `EMBED_DIMENSIONS` in
 * `documents-schema.ts`). Mirrors the app's `env.ts`; keeps `config.ts` pure.
 */
export const appEnv = resolveAppEnv(process.env.APP_ENV);

function ragEnv() {
  return createEnv({
    shared: {
      NODE_ENV: z
        .enum(['development', 'production', 'test'])
        .default('development'),
      // Per-app identity — names the Postgres/pgvector schema. Must be a valid
      // Postgres identifier: lowercase letter, then lowercase/digits/underscores.
      NEXT_PUBLIC_WEBAPP: z
        .string()
        .regex(
          /^[a-z][a-z0-9_]*$/,
          'NEXT_PUBLIC_WEBAPP must be a valid Postgres identifier: lowercase letter then lowercase/digits/underscores',
        ),
    },
    // The vector database name and chunker knobs are config-as-code now
    // (`config.ts`, ADR 0026). Only the per-app schema selector + runtime mode
    // remain env; `@acme/rag` has no non-selector server env left.
    server: {},
    client: {},
    runtimeEnv: {
      NEXT_PUBLIC_WEBAPP: process.env.NEXT_PUBLIC_WEBAPP,
      NODE_ENV: process.env.NODE_ENV,
    },
    skipValidation,
  });
}

export const env = ragEnv();
