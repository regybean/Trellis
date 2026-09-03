import { createAuthClient } from 'better-auth/react';

/**
 * App-owned Better Auth React client. Better Auth ships no UI, so the app owns
 * the client and `@acme/ui` owns the presentation (@acme/auth ADR 0001).
 *
 * **No `baseURL`.** The client is same-origin: it appends Better Auth's default
 * `/api/auth` base path to the origin it was loaded from, which is the one thing
 * the browser always knows and the client bundle therefore never has to be told.
 * `env.BETTER_AUTH_URL` is the server's view of that same origin and stays
 * server-side — a client read of it would be a second source of truth that could
 * disagree with the address the user actually typed.
 *
 * **No plugins.** The admin plugin's *server* half is registered inside
 * `initAuth`, but nothing in the browser calls an admin endpoint directly: the
 * role mutations go through the server functions in `lib/admin.ts`, so
 * `adminClient()` would only add surface area.
 *
 * The session cookie is HttpOnly, so this client is the only thing in the browser
 * that knows anything about auth, and all it holds is what `/api/auth/get-session`
 * returns.
 */
export const authClient = createAuthClient();
