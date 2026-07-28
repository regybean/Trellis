import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod/v4';

import { resolveAppEnv } from '@acme/config';
import { shouldSkipEnvValidation } from '@acme/env';

import { dbConfig } from './config';

const skipValidation = shouldSkipEnvValidation();

/**
 * The config-as-code deploy-target selector (ADR 0026), resolved at this slice's
 * sanctioned `process.env` edge and threaded into `dbConfig`.
 */
export const appEnv = resolveAppEnv(process.env.APP_ENV);

// The one remaining DB secret. Host/port/user/name are config-as-code (see
// `config.ts`); only the password leaks access, so it stays in `process.env`.
const secretEnv = createEnv({
  server: {
    DB_PASSWORD: z.string().nonempty(),
  },
  runtimeEnv: {
    // When validation is skipped (lint / the Next production build / a bare
    // worktree — see `shouldSkipEnvValidation`) there is no real password and
    // none is needed: no query runs. But Mastra's `PgVector`/`PostgresStore`
    // validate a non-empty password in their *constructor*, which the Next build
    // triggers by importing the chat route to collect page data. Stub it in that
    // case so construction succeeds; runtime and vitest never skip validation, so
    // the real secret is still enforced there.
    DB_PASSWORD:
      process.env.DB_PASSWORD ??
      (skipValidation ? 'skip-validation-stub' : undefined),
  },
  skipValidation,
});

const config = dbConfig({ appEnv, isServer: true });

/**
 * The resolved Postgres connection (ADR 0026). `config.ts` is the authored
 * source — development works from its defaults with no `.env` rows.
 *
 * Only `host`/`port` carry a runtime `process.env` override: they are *dynamic*
 * (a testcontainer hands back a mapped port, a prod endpoint is infra-injected)
 * so static config cannot know them. `user`/`name` are *static per deploy target*
 * — pure config-as-code; a target that needs different values adds a config
 * profile, not an env override (the testcontainer already runs as the config
 * default `postgres`/`testdb`, see `testing.ts`). `DB_PASSWORD` is the sole secret.
 *
 * Kept as the `env` export (same `DB_*` shape as before) so `createDb()` and the
 * rag storage/vector clients read it unchanged.
 */
export const env = {
  DB_HOST: process.env.DB_HOST ?? config.DB_HOST,
  DB_PORT: process.env.DB_PORT ? Number(process.env.DB_PORT) : config.DB_PORT,
  DB_USER: config.DB_USER,
  DB_NAME: config.DB_NAME,
  DB_PASSWORD: secretEnv.DB_PASSWORD,
};
