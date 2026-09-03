import { createEnv } from '@t3-oss/env-core';

import { chatEnv } from '@acme/chat/env';
import { resolveAppEnv } from '@acme/env';
import { ingestEnv } from '@acme/ingest/env';

/**
 * The config-as-code deploy-target selector, resolved once at the app's single
 * sanctioned `process.env` edge. `APP_ENV` is inlined into the client bundle by
 * `vite.config.ts`, so it resolves identically server + client.
 */
export const appEnv = resolveAppEnv(process.env.APP_ENV);

/**
 * The app's **one** composition edge (@acme/env ADR 0001): one `extends` list carrying each
 * slice's config *and* secrets, where there used to be this list plus a parallel
 * `configExtends([...])` in `src/config.ts`. The same preset list the slim Next.js
 * app composes, so both slim apps validate the identical runtime surface.
 *
 * This app strips auth and billing (ADR 0010), so it composes only chat +
 * ingest — and because a secret's requiredness follows what the app assembles, it
 * never demands the auth or Stripe secrets. `skipValidation` is not passed here
 * or anywhere (@acme/env ADR 0001 §3).
 */
export const env = createEnv({
  clientPrefix: 'NEXT_PUBLIC_',
  extends: [chatEnv(), ingestEnv()],
  server: {},
  client: {},
  runtimeEnv: {},
});
