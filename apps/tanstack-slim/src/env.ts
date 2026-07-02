import { createEnv } from '@t3-oss/env-nextjs';

import { chatEnv } from '@acme/chat/env';
import { ingestEnv } from '@acme/ingest/env';

// TanStack Start has no Next.js build phase, so NEXT_PHASE is omitted.
const skipValidation =
  !!process.env.CI || process.env.npm_lifecycle_event === 'lint';

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
