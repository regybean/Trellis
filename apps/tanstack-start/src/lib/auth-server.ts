import { initAuth } from '@acme/auth/server';

import { env } from '~/env';

/**
 * The app's Better Auth instance — the TanStack Start side of the app-owned auth
 * seam (ADR 0034, replacing the Clerk resolver of ADR 0003).
 *
 * `initAuth` is a factory, not a module singleton, because `baseUrl` is app
 * knowledge: this app serves on 3001 and `apps/nextjs` on 3000, and a
 * shared-layer package must not read app env. The secret is deliberately *not*
 * passed — `BETTER_AUTH_SECRET` is slice-owned and validated inside
 * `@acme/auth/env`.
 *
 * Three things consume this instance, and all three are app-owned:
 * `routes/api/auth.$.ts` mounts `auth.handler`, `lib/auth.ts` resolves the
 * session for the route guards, and `lib/trpc-context.ts` resolves it for the
 * tRPC context. No feature or shared package ever touches it.
 *
 * Better Auth's own `tanstackStartCookies()` plugin is deliberately not
 * registered. It exists to copy `Set-Cookie` onto the framework response when
 * `auth.api.*` is called from a server function; every credential mutation here
 * goes through the mounted handler instead (the browser posts to
 * `/api/auth/*` via `createAuthClient`), so that handler's own `Response`
 * already carries the cookie. Adding the plugin would also put a
 * framework-specific dependency inside `@acme/auth`, which is the one thing the
 * seam exists to prevent.
 */
export const auth = initAuth({ baseUrl: env.BETTER_AUTH_URL });
