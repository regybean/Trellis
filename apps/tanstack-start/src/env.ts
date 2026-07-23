import { createEnv } from '@t3-oss/env-nextjs';

import { billingEnv } from '@acme/billing/env';
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
 * Server env for the TanStack Start app. Composes the same feature env presets
 * the Next.js app uses, so both apps validate the identical runtime surface.
 *
 * The client-side Clerk publishable key is read directly from
 * `import.meta.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (Vite `envPrefix` exposes
 * it) rather than through this schema, since `@t3-oss/env` reads `process.env`
 * which Vite does not populate in the browser.
 */
export const env = createEnv({
  extends: [chatEnv(), ingestEnv(), billingEnv()],
  server: {},
  client: {},
  runtimeEnv: {},
  skipValidation,
});
