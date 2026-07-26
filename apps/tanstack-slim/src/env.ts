import { createEnv } from '@t3-oss/env-nextjs';

import { chatEnv } from '@acme/chat/env';
import { resolveAppEnv } from '@acme/config';
import { shouldSkipEnvValidation } from '@acme/env';
import { ingestEnv } from '@acme/ingest/env';

// TanStack Start has no Next.js build phase, so NEXT_PHASE is omitted.
const skipValidation = shouldSkipEnvValidation();

/**
 * The config-as-code deploy-target selector (ADR 0026). Resolved once here —
 * `env.ts` is the app's single sanctioned `process.env` edge — and threaded into
 * config slices via `configExtends` in `./config`. `APP_ENV` is inlined into the
 * client bundle by `vite.config.ts`, so it resolves identically server + client.
 */
export const appEnv = resolveAppEnv(process.env.APP_ENV);

/**
 * Server env for the slim TanStack Start app. Composes the chat + ingest feature
 * env presets (no billing). Both slim apps validate the identical runtime
 * surface.
 */
export const env = createEnv({
  extends: [chatEnv(), ingestEnv()],
  server: {},
  client: {},
  runtimeEnv: {},
  skipValidation,
});
