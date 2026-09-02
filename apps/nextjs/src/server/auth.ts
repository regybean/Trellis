import 'server-only';

import { initAuth } from '@acme/auth/server';

import { env } from '~/env';

/**
 * This app's Better Auth instance (#223, ADR 0034).
 *
 * `@acme/auth` ships a factory rather than a module singleton because `baseUrl`
 * is per-app — each app binds its own port and its own deployed origin — and a
 * shared-layer package must not read app env. So the app constructs it, which is
 * the auth seam being app-owned in the literal sense (ADR 0003).
 *
 * One instance per server runtime, shared by the route handler, the tRPC session
 * resolver and the admin actions, so they cannot disagree about configuration.
 */
export const auth = initAuth({ baseUrl: env.BETTER_AUTH_URL });
