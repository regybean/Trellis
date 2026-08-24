import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod/v4';

import { readEnv, resolveAppEnv, withProfiles } from '@acme/env';

/** The deploy-target selector, resolved at this slice's `process.env` edge. */
const appEnv = resolveAppEnv(process.env.APP_ENV);

/**
 * Clerk's **browser-safe wiring**, with no secret in the call.
 *
 * The sign-in/up route URLs are static and identical on every deploy target; the
 * **publishable key** is public (it ships in the client bundle by design) but
 * differs per Clerk instance, so it carries a profile per target. All five used to
 * be `NEXT_PUBLIC_CLERK_*` rows copy-pasted across every app's `.env.*`; the
 * prefix is dropped because it was an env-bundling mechanism and these are
 * authored values. They live in `shared` rather than `client` for exactly that
 * reason: t3-env requires the `NEXT_PUBLIC_` prefix on `client` keys, and the
 * prefix would be a lie on a value never read from the environment. `shared` also
 * means a browser-side read resolves them from the profile, which is what
 * `<ClerkProvider publishableKey>` needs.
 *
 * ⚠️ **This is the one place ADR 0033's one-call-per-slice shape bends, and the
 * reason is the runtime, not the config/secret line.** `apps/nextjs`'s
 * `middleware.ts` runs in the **Edge** runtime and needs only the publishable key.
 * Calling `authEnv()` there would validate `CLERK_SECRET_KEY` in a runtime whose
 * `process.env` is a build-time snapshot — a variable injected only at container
 * runtime is not reachable by an index access there, so a correctly configured
 * deploy would 500 on every request. Reading this subset instead demands nothing
 * a browser or an edge worker cannot have.
 */
export function clerkWiringEnv() {
  return createEnv({
    clientPrefix: 'NEXT_PUBLIC_',
    client: {},
    shared: {
      CLERK_SIGN_IN_URL: z.string().startsWith('/'),
      CLERK_SIGN_UP_URL: z.string().startsWith('/'),
      CLERK_SIGN_IN_FORCE_REDIRECT_URL: z.string().startsWith('/'),
      CLERK_SIGN_UP_FORCE_REDIRECT_URL: z.string().startsWith('/'),
      CLERK_PUBLISHABLE_KEY: z.string().startsWith('pk_'),
    },
    createFinalSchema: (shape) =>
      withProfiles(shape, appEnv, {
        default: {
          CLERK_SIGN_IN_URL: '/sign-in',
          CLERK_SIGN_UP_URL: '/sign-up',
          CLERK_SIGN_IN_FORCE_REDIRECT_URL: '/',
          CLERK_SIGN_UP_FORCE_REDIRECT_URL: '/',
          CLERK_PUBLISHABLE_KEY:
            'pk_test_dG9sZXJhbnQtb3J5eC05My5jbGVyay5hY2NvdW50cy5kZXYk',
        },
        staging: {
          CLERK_PUBLISHABLE_KEY: 'pk_live_Y2xlcmsuc3RhZ2luZy5jeXJhaWwuY28udWsk',
        },
        production: {
          CLERK_PUBLISHABLE_KEY: 'pk_live_Y2xlcmsuY3lyYWlsLmNvLnVrJA',
        },
      }),
    runtimeEnv: {
      CLERK_SIGN_IN_URL: readEnv('CLERK_SIGN_IN_URL'),
      CLERK_SIGN_UP_URL: readEnv('CLERK_SIGN_UP_URL'),
      CLERK_SIGN_IN_FORCE_REDIRECT_URL: readEnv(
        'CLERK_SIGN_IN_FORCE_REDIRECT_URL',
      ),
      CLERK_SIGN_UP_FORCE_REDIRECT_URL: readEnv(
        'CLERK_SIGN_UP_FORCE_REDIRECT_URL',
      ),
      CLERK_PUBLISHABLE_KEY: readEnv('CLERK_PUBLISHABLE_KEY'),
    },
    emptyStringAsUndefined: true,
  });
}

/**
 * The whole slice: the wiring above **plus** its secret (ADR 0033). Called lazily
 * and composed into an app's env graph via `extends: [authEnv(), …]` by the two
 * *full* apps only — the `*-slim` apps mount no auth, so they never demand the
 * secret (ADR 0010, composition axis).
 *
 * `CLERK_SECRET_KEY` is the one key no profile authors, so it is the one key a
 * deploy target must supply. This is *validation-only*: the Clerk SDK
 * (`clerkClient()` / `auth()` / `clerkMiddleware()`) keeps reading it implicitly
 * from `process.env` — passing `secretKey` to middleware would flip Clerk into
 * Dynamic Keys mode (#94). Declaring it forces a full app to fail fast at boot on
 * a missing key instead of on the first Clerk call with an opaque error.
 *
 * Because the app composes this one call, the slice cannot ship its wiring with
 * its gated secret unvalidated — the failure the old two-mechanism split allowed
 * (`authConfig` once shipped with no secret validation at all).
 */
export function authEnv() {
  return createEnv({
    clientPrefix: 'NEXT_PUBLIC_',
    extends: [clerkWiringEnv()],
    client: {},
    server: {
      CLERK_SECRET_KEY: z.string().nonempty(),
    },
    createFinalSchema: (shape) => withProfiles(shape, appEnv, { default: {} }),
    runtimeEnv: {
      CLERK_SECRET_KEY: readEnv('CLERK_SECRET_KEY'),
    },
    emptyStringAsUndefined: true,
  });
}
