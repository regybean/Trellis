import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod/v4';

import { serverConfigContext } from '@acme/config';
import { shouldSkipEnvValidation } from '@acme/env';

import { dbConfig } from './config';

const skipValidation = shouldSkipEnvValidation();

/**
 * The config-as-code deploy-target selector (ADR 0026), resolved at this slice's
 * sanctioned `process.env` edge and threaded into `dbConfig`.
 *
 * The same edge samples the **override** bag (ADR 0033), which is what makes
 * `DB_HOST` / `DB_PORT` dynamic: a testcontainer hands back a mapped port and a
 * prod endpoint is infra-injected, neither of which static config can know. This
 * slice used to hand-roll exactly that as `process.env.DB_HOST ?? config.DB_HOST`
 * — the seed the general override layer grew from, and now the general path
 * covers it for every key, not just the two someone remembered to wire.
 */
export const configContext = serverConfigContext(process.env);

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

const config = dbConfig(configContext);

/**
 * The resolved Postgres connection (ADR 0026). `config.ts` is the authored
 * source — development works from its defaults with no `.env` rows — and any of
 * `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_NAME` is retunable by a same-name
 * variable through the config override lane (ADR 0033), so the hand-written
 * `?? config.X` fallbacks that used to sit here are gone: `configContext` carries
 * the whole bag and `dbConfig` coerces + validates whatever it finds.
 *
 * `DB_PASSWORD` stays the sole secret and stays in `createEnv`: a leaked password
 * grants access, so it never becomes an overridable config key — the collision
 * guard in `scripts/check-config-overrides.ts` makes that a lint failure rather
 * than a judgement call.
 *
 * Kept as the `env` export (same `DB_*` shape as before) so `createDb()` and the
 * rag storage/vector clients read it unchanged.
 */
export const env = {
  DB_HOST: config.DB_HOST,
  DB_PORT: config.DB_PORT,
  DB_USER: config.DB_USER,
  DB_NAME: config.DB_NAME,
  DB_PASSWORD: secretEnv.DB_PASSWORD,
};
