import { createEnv } from '@t3-oss/env-nextjs';

import { chatEnv } from '@acme/chat/env';
import { ingestEnv } from '@acme/ingest/env';

export const env = createEnv({
  extends: [chatEnv(), ingestEnv()],
  /**
   * Specify your server-side environment variables schema here.
   * This way you can ensure the app isn't built with invalid env vars.
   */
  server: {},
  /**
   * Specify your client-side environment variables schema here.
   * For them to be exposed to the client, prefix them with `NEXT_PUBLIC_`.
   */
  client: {},
  /**
   * Destructure all variables from `process.env` to make sure they aren't tree-shaken away.
   */
  runtimeEnv: {},
  skipValidation:
    !!process.env.CI ||
    process.env.npm_lifecycle_event === 'lint' ||
    process.env.NEXT_PHASE === 'phase-production-build',
});
