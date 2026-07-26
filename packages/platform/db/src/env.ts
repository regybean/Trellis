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
    DB_PASSWORD: process.env.DB_PASSWORD,
  },
  skipValidation,
});

const config = dbConfig({ appEnv, isServer: true });

/**
 * The resolved Postgres connection (ADR 0026, Option 1). `config.ts` is the
 * authored source — development works from its defaults with no `.env` rows — but
 * the host/port accept a runtime `process.env` override, the seam a dynamic
 * testcontainer endpoint (and an infra-injected prod endpoint) needs: static
 * config cannot know a mapped port. `DB_PASSWORD` is the sole secret.
 *
 * Kept as the `env` export (same `DB_*` shape as before) so `createDb()` and the
 * rag storage/vector clients read it unchanged.
 */
export const env = {
  DB_HOST: process.env.DB_HOST ?? config.DB_HOST,
  DB_PORT: process.env.DB_PORT ? Number(process.env.DB_PORT) : config.DB_PORT,
  DB_USER: process.env.DB_USER ?? config.DB_USER,
  DB_NAME: process.env.DB_NAME ?? config.DB_NAME,
  DB_PASSWORD: secretEnv.DB_PASSWORD,
};
