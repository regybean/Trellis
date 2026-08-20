import { createEnv } from '@t3-oss/env-nextjs';

import { authEnv } from '@acme/auth/env';
import { billingEnv } from '@acme/billing/env';
import { chatEnv } from '@acme/chat/env';
import { appConfigContext } from '@acme/config';
import { shouldSkipEnvValidation } from '@acme/env';
import { ingestEnv } from '@acme/ingest/env';

const skipValidation = shouldSkipEnvValidation();

/**
 * The app's single config edge (ADR 0026 §4, ADR 0033). `env.ts` is the one
 * sanctioned `process.env` read, so it resolves everything `config.ts` needs and
 * threads it in: the `APP_ENV` deploy-target selector, the runtime side, and both
 * override lanes.
 *
 * The **server** lane is the live `process.env`, so any server config value is
 * retunable on a deployed container. The **client** lane can't be — client config
 * is inlined and frozen at build — so it is read back from the literal the
 * bundler baked in (`next.config.js`'s `env` map / `vite.config.ts`'s `define`,
 * both filled by `clientOverrideBuildEnv`). `APP_ENV` is inlined the same way, so
 * the profile resolves identically on server and client.
 */
export const configContext = appConfigContext({
  appEnv: process.env.APP_ENV,
  clientOverrides: process.env.ACME_CONFIG_CLIENT_OVERRIDES,
  serverEnv: () => process.env,
});

export const env = createEnv({
  extends: [chatEnv(), ingestEnv(), billingEnv(), authEnv()],
  server: {},
  // The Clerk publishable key is now config-as-code (authConfig, ADR 0026),
  // threaded into <ClerkProvider> + clerkMiddleware; only CLERK_SECRET_KEY stays
  // in env, validated by authEnv() (composed by full apps only, ADR 0010).
  client: {},
  runtimeEnv: {},
  skipValidation,
});
