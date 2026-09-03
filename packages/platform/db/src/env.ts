import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod/v4';

import {
  readEnv,
  resolveAppEnv,
  shouldSkipEnvValidation,
  withProfiles,
} from '@acme/env';

import { DB_DEVELOPMENT_PROFILE } from './development-profile';

/**
 * The deploy-target selector, resolved at this slice's sanctioned `process.env`
 * edge (@acme/env ADR 0001 §2). Each slice resolves the same selector at its own
 * edge, so
 * the profiles agree without threading a context.
 */
const appEnv = resolveAppEnv(process.env.APP_ENV);

/**
 * The resolved Postgres connection, declared once (@acme/env ADR 0001). Read by
 * `createDb()` and the rag storage/vector clients.
 *
 * **Config** — host, port, user and database name carry profile values, so a
 * clean checkout connects to the local stack with no `.env` rows. Every key is in
 * `runtimeEnv`, so every key is env-overridable (@acme/env ADR 0001 §4); `DB_HOST` /
 * `DB_PORT` are the two that *must* be — a testcontainer hands back a mapped port
 * and a prod endpoint is infra-injected, so no profile can know them. That used to
 * be hand-rolled here as `process.env.DB_HOST ?? config.DB_HOST` and
 * `Number(process.env.DB_PORT)`; coercion now lives in the schema, so `DB_PORT=abc`
 * fails loudly instead of reaching a caller as `NaN`.
 *
 * **Secret** — `DB_PASSWORD` carries no profile value on any target, so it is
 * demanded everywhere: a leaked password grants access, and the local container's
 * throwaway comes from `deploy/.env` (which `pnpm dev` / `pnpm with-env` load)
 * rather than from a literal that a real deploy could inherit by accident.
 */
export const env = createEnv({
  clientPrefix: 'NEXT_PUBLIC_',
  client: {},
  server: {
    DB_HOST: z.string().nonempty(),
    DB_PORT: z.coerce.number().int().positive(),
    DB_USER: z.string().nonempty(),
    DB_NAME: z.string().nonempty(),
    DB_PASSWORD: z.string().nonempty(),
  },
  createFinalSchema: (shape) =>
    withProfiles(shape, appEnv, {
      default: DB_DEVELOPMENT_PROFILE,
    }),
  runtimeEnv: {
    DB_HOST: readEnv('DB_HOST'),
    DB_PORT: readEnv('DB_PORT'),
    DB_USER: readEnv('DB_USER'),
    DB_NAME: readEnv('DB_NAME'),
    // When this run cannot supply secrets (lint / the Next production build,
    // which builds with a real `APP_ENV` — see `shouldSkipEnvValidation`) there is
    // no password and none is needed: no query runs. But Mastra's
    // `PgVector`/`PostgresStore` validate a non-empty password in their
    // *constructor*, which the Next build triggers by importing the chat route to
    // collect page data. Stub it in that case so construction succeeds (ADR 0024);
    // runtime and vitest never skip, so the real secret is still enforced there.
    DB_PASSWORD:
      readEnv('DB_PASSWORD') ??
      (shouldSkipEnvValidation() ? 'skip-validation-stub' : undefined),
  },
  emptyStringAsUndefined: true,
});
