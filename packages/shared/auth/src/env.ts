import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod/v4';

import { readEnv, resolveAppEnv, secretsOnly } from '@acme/env';

/** The deploy-target selector, resolved at this slice's `process.env` edge. */
const appEnv = resolveAppEnv(process.env.APP_ENV);

/**
 * Better Auth's own secret, and **nothing else** — the env an app on the
 * self-hosted provider needs.
 *
 * The one key here is the one key the slice itself reads: `initAuth` pulls
 * `BETTER_AUTH_SECRET` out of this call. Declaring it here is what makes a
 * misconfigured app fail fast at boot rather than silently fall back to Better
 * Auth's hardcoded development secret. Generate with `openssl rand -base64 32`.
 *
 * **`BETTER_AUTH_URL` is deliberately not here** — it is authored by each app's
 * own `createEnv` (#239 settled this; both migration branches declared it, in
 * different places). It is the origin the auth routes are mounted on, and the
 * apps mount them on different ones: `apps/nextjs` on 3000, `apps/tanstack-start`
 * on 3001. That is the same fact `initAuth` already encodes by taking `baseUrl`
 * as a parameter instead of reading it — a slice-level declaration would be a
 * slice validating a key it never reads and cannot author a default for, while
 * the app can author one per profile like any other config row (@acme/env ADR 0001 §4).
 */
export function betterAuthEnv() {
  return createEnv({
    clientPrefix: 'NEXT_PUBLIC_',
    client: {},
    server: {
      BETTER_AUTH_SECRET: z.string().nonempty(),
    },
    createFinalSchema: secretsOnly(appEnv),
    runtimeEnv: {
      BETTER_AUTH_SECRET: readEnv('BETTER_AUTH_SECRET'),
    },
    emptyStringAsUndefined: true,
  });
}
