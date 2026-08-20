import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod/v4';

import { serverConfigContext } from '@acme/config';
import { shouldSkipEnvValidation } from '@acme/env';

import { redisConfig } from './config';

const skipValidation = shouldSkipEnvValidation();

/**
 * The config-as-code deploy-target selector (ADR 0026), resolved at this slice's
 * sanctioned `process.env` edge and threaded into `redisConfig`.
 *
 * The same edge samples the **override** bag (ADR 0033): every one of this
 * slice's config values can be retuned by a same-name environment variable at
 * runtime, so nothing here has to be re-authored per deploy.
 */
export const configContext = serverConfigContext(process.env);

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
const config = redisConfig(configContext);

/**
 * The resolved Redis env (ADR 0026). `config.ts` is the authored source for
 * `REDIS_URL` — development works from its default with no `.env` row — and a
 * same-name variable retunes it at runtime through the config override lane
 * (ADR 0033), which is what the *dynamic* cases need: a testcontainer hands back
 * a mapped port and a prod endpoint is infra-injected. The hand-written
 * `process.env.REDIS_URL ?? config.REDIS_URL` that used to sit here is gone —
 * `configContext` carries the bag and `redisConfig` validates the result, so the
 * URL is still checked rather than passed through raw.
 *
 * `NODE_ENV`/`NEXT_PUBLIC_WEBAPP` are selectors and stay pure `process.env`.
 *
 * Kept as the `env` export (same shape as before) so `./client` reads it unchanged.
 */
export const env = {
  NODE_ENV: baseEnv.NODE_ENV,
  NEXT_PUBLIC_WEBAPP: baseEnv.NEXT_PUBLIC_WEBAPP,
  REDIS_URL: config.REDIS_URL,
};
