import { createEnv } from '@t3-oss/env-nextjs';

import { billingEnv } from '@acme/billing/env';
import { chatEnv } from '@acme/chat/env';
import { ingestEnv } from '@acme/ingest/env';

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
  skipValidation:
    !!process.env.CI || process.env.npm_lifecycle_event === 'lint',
});
