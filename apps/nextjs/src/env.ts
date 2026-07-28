import { createEnv } from '@t3-oss/env-nextjs';

import { authEnv } from '@acme/auth/env';
import { billingEnv } from '@acme/billing/env';
import { chatEnv } from '@acme/chat/env';
import { resolveAppEnv } from '@acme/config';
import { shouldSkipEnvValidation } from '@acme/env';
import { ingestEnv } from '@acme/ingest/env';

const skipValidation = shouldSkipEnvValidation();

/**
 * The config-as-code deploy-target selector (ADR 0026). Resolved once here —
 * `env.ts` is the app's single sanctioned `process.env` edge — and threaded into
 * config slices via `configExtends` in `./config`. `APP_ENV` is inlined into the
 * client bundle by `next.config.js`, so it resolves identically server + client.
 */
export const appEnv = resolveAppEnv(process.env.APP_ENV);

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
