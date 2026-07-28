import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod/v4';

import { resolveAppEnv } from '@acme/config';
import { shouldSkipEnvValidation } from '@acme/env';

import { redisConfig } from './config';

const skipValidation = shouldSkipEnvValidation();

/**
 * The config-as-code deploy-target selector (ADR 0026), resolved at this slice's
 * sanctioned `process.env` edge and threaded into `redisConfig`.
 */
export const appEnv = resolveAppEnv(process.env.APP_ENV);

// App identity stays in env — it is a *selector* (the per-app Namespace), not
// config. `REDIS_URL` moved to `config.ts` (config-as-code); only these
// selectors are validated here.
function redisEnv() {
  return createEnv({
    shared: {
      NODE_ENV: z
        .enum(['development', 'production', 'test'])
        .default('development'),
      // App identity — partitions every shared datastore per app. Mirrors the
      // per-app Postgres schema (see @acme/rag env). Drives the Redis key
      // prefix so the two apps never collide on one shared Redis instance.
      // Must be a valid Postgres identifier — it names a schema and the Redis
      // key prefix. Lowercase letter, then lowercase/digits/underscores (no
      // hyphens). Fails loud rather than silently producing a broken schema.
      NEXT_PUBLIC_WEBAPP: z
        .string()
        .regex(
          /^[a-z][a-z0-9_]*$/,
          'NEXT_PUBLIC_WEBAPP must be a valid Postgres identifier: lowercase letter then lowercase/digits/underscores',
        ),
    },
    runtimeEnv: {
      NEXT_PUBLIC_WEBAPP: process.env.NEXT_PUBLIC_WEBAPP,
      NODE_ENV: process.env.NODE_ENV,
    },
    skipValidation,
  });
}

const baseEnv = redisEnv();
const config = redisConfig({ appEnv, isServer: true });

/**
 * The resolved Redis env (ADR 0026). `config.ts` is the authored source for
 * `REDIS_URL` — development works from its default with no `.env` row.
 *
 * Only `REDIS_URL` carries a runtime `process.env` override: it is *dynamic* (a
 * testcontainer hands back a mapped port, a prod endpoint is infra-injected) so
 * static config cannot know it. `NODE_ENV`/`NEXT_PUBLIC_WEBAPP` are selectors and
 * stay pure `process.env`.
 *
 * Kept as the `env` export (same shape as before) so `./client` reads it unchanged.
 */
export const env = {
  NODE_ENV: baseEnv.NODE_ENV,
  NEXT_PUBLIC_WEBAPP: baseEnv.NEXT_PUBLIC_WEBAPP,
  REDIS_URL: process.env.REDIS_URL ?? config.REDIS_URL,
};
