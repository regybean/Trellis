import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod/v4';

import { readEnv, resolveAppEnv, secretsOnly, withProfiles } from '@acme/env';

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
 * Better Auth's own secret, and nothing else — the env an app on the self-hosted
 * provider needs (#223).
 *
 * Split out from `authEnv` below because the two full apps are on different
 * providers during the #218 migration: `apps/nextjs` composes *this*, and so
 * demands no Clerk key it will never use, while `apps/tanstack-start` still
 * composes the Clerk-shaped `authEnv`. `initAuth` reads this one too, so
 * standing up a Better Auth instance never requires a Clerk secret.
 *
 * *Validation-only*: Better Auth is handed the value explicitly by `initAuth`,
 * but declaring it here is what makes a misconfigured app fail fast at boot
 * rather than silently fall back to Better Auth's hardcoded development secret.
 * Generate with `openssl rand -base64 32`.
 */
export function betterAuthEnv() {
  return createEnv({
    clientPrefix: 'NEXT_PUBLIC_',
    client: {},
    server: {
      BETTER_AUTH_SECRET: z.string().nonempty(),
      // The origin the auth routes are mounted on, which Better Auth builds
      // callback URLs from and validates request origins against. Deliberately
      // *not* profile-authored: it is per-app (each app binds its own `PORT`)
      // and per-deploy, so there is no value a profile could hold that would be
      // right for the next app — the same reason `PORT` and `NEXT_PUBLIC_WEBAPP`
      // are plain `.env` rows. It must be the externally reachable origin, not
      // the container's.
      BETTER_AUTH_URL: z.url(),
    },
    createFinalSchema: secretsOnly(appEnv),
    runtimeEnv: {
      BETTER_AUTH_SECRET: readEnv('BETTER_AUTH_SECRET'),
      BETTER_AUTH_URL: readEnv('BETTER_AUTH_URL'),
    },
    emptyStringAsUndefined: true,
  });
}

/**
 * The **Clerk** slice: the wiring above, its secret, and (through `extends`)
 * Better Auth's. Called lazily and composed into an app's env graph via
 * `extends: [authEnv(), …]` — since #223 that is `apps/tanstack-start` alone,
 * the last app still on Clerk. `apps/nextjs` composes `betterAuthEnv()`
 * instead, and the `*-slim` apps mount no auth at all, so they demand neither
 * secret (ADR 0010, composition axis). This whole function retires with Clerk.
 *
 * `CLERK_SECRET_KEY` is a key no profile authors, so it is a key a deploy target
 * must supply. It is *validation-only*: the Clerk SDK (`clerkClient()` /
 * `auth()` / `clerkMiddleware()`) keeps reading it off `process.env` — passing
 * `secretKey` to Clerk middleware would flip it into Dynamic Keys mode (#94).
 * Declaring it forces a full app to fail fast at boot on a missing key instead
 * of on the first call with an opaque error.
 *
 * Because the app composes this one call, the slice cannot ship its wiring with
 * its gated secret unvalidated — the failure the old two-mechanism split allowed
 * (`authConfig` once shipped with no secret validation at all).
 */
export function authEnv() {
  return createEnv({
    clientPrefix: 'NEXT_PUBLIC_',
    extends: [clerkWiringEnv(), betterAuthEnv()],
    client: {},
    server: {
      // Clerk secret. Clerk is still this app's live auth provider (#218
      // migrates the apps; `apps/nextjs` came off it in #223, leaving
      // `apps/tanstack-start` as the only caller); this row goes when it does.
      //
      // This is *validation-only*: the Clerk SDK (`clerkClient()`/`auth()`/
      // `clerkMiddleware()`) keeps reading `CLERK_SECRET_KEY` implicitly from
      // `process.env` — the key is never passed to Clerk here (passing
      // `secretKey` to middleware would flip Clerk into Dynamic Keys mode, #94).
      // Declaring it forces a full app to fail fast at boot on a missing key
      // instead of on the first Clerk call with an opaque error.
      CLERK_SECRET_KEY: z.string().nonempty(),
    },
    createFinalSchema: secretsOnly(appEnv),
    runtimeEnv: {
      CLERK_SECRET_KEY: readEnv('CLERK_SECRET_KEY'),
    },
    emptyStringAsUndefined: true,
  });
}
