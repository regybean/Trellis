import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod/v4';

import { betterAuthEnv } from '@acme/auth/env';
import { billingEnv } from '@acme/billing/env';
import { chatEnv } from '@acme/chat/env';
import { readEnv, resolveAppEnv, withProfiles } from '@acme/env';
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
 *
 * `BETTER_AUTH_URL` is the one key this call **authors** rather than composes,
 * and it is app-owned for a structural reason: it is the origin the Better Auth
 * routes are mounted on, and each app in this repo runs on its own port (this
 * one on 3000, `tanstack-start` on 3001). A shared-layer package cannot know it,
 * which is exactly why `initAuth` takes `baseUrl` as a parameter while keeping
 * `BETTER_AUTH_SECRET` slice-owned in `@acme/auth/env` (ADR 0034). It is config,
 * not a secret — the profile authors the dev origin and a deploy target
 * overrides it by environment variable like any other key (ADR 0033 §4).
 * Server-only: the browser never needs it, because `createAuthClient` is
 * same-origin and appends Better Auth's base path to whatever origin it is
 * loaded from.
 */
export const env = createEnv({
  clientPrefix: 'NEXT_PUBLIC_',
  extends: [chatEnv(), ingestEnv(), billingEnv(), betterAuthEnv()],
  server: {
    BETTER_AUTH_URL: z.url(),
  },
  client: {},
  createFinalSchema: (shape) =>
    withProfiles(shape, appEnv, {
      default: { BETTER_AUTH_URL: 'http://localhost:3000' },
    }),
  runtimeEnv: {
    BETTER_AUTH_URL: readEnv('BETTER_AUTH_URL'),
  },
});
