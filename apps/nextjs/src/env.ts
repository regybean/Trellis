import { createEnv } from '@t3-oss/env-core';

import { betterAuthEnv } from '@acme/auth/env';
import { billingEnv } from '@acme/billing/env';
import { chatEnv } from '@acme/chat/env';
import { resolveAppEnv } from '@acme/env';
import { ingestEnv } from '@acme/ingest/env';

/**
 * The config-as-code deploy-target selector. Resolved once here — `env.ts` is the
 * app's single sanctioned `process.env` edge — for anything app-owned that needs
 * it. Each slice resolves the same selector at its own edge, so the profiles agree
 * without threading a context. `APP_ENV` is inlined into the client bundle by
 * `next.config.js`, so it resolves identically server + client.
 */
export const appEnv = resolveAppEnv(process.env.APP_ENV);

/**
 * The app's **one** composition edge (ADR 0033). It used to be two: this
 * `extends` list for secrets and a parallel `configExtends([...])` in
 * `src/config.ts` for the non-secret values. Each slice now declares both halves
 * in one `createEnv` call, so composing the app is composing one list.
 *
 * Each preset validates its own keys at boot (ADR 0022 two-axis validation) —
 * `betterAuthEnv()` the Better Auth signing secret (composed by the full apps
 * only, ADR 0010), `billingEnv()` the Stripe plan ids/connection and the two Stripe
 * secrets, `chatEnv()` and `ingestEnv()` their slices' tunables plus ingest's AWS
 * credentials.
 *
 * **`skipValidation` is not passed, here or anywhere** (ADR 0033 §3). It used to
 * be, and it made this edge a trapdoor: `createEnv` returns `runtimeEnv` *before*
 * merging `extends`, so with `runtimeEnv: {}` the composed `env` was literally
 * `{}` on every skip path. Nothing skips now — `withProfiles` relaxes the secrets
 * per key instead, so config defaults survive a lint/build run.
 *
 * Server-side reads come through this object. **Client-side reads come from the
 * owning slice's env** (e.g. `@acme/billing/env`'s `shared` Stripe keys), because
 * t3-env's access guard is name-based: it consults the *reading* call's `shared`
 * dict, and this call declares none.
 */
export const env = createEnv({
  clientPrefix: 'NEXT_PUBLIC_',
  extends: [chatEnv(), ingestEnv(), billingEnv(), betterAuthEnv()],
  server: {},
  client: {},
  runtimeEnv: {},
});
