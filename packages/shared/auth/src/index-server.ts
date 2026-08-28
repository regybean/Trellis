/**
 * Backend auth surface — no `'use client'` boundary, so it can *run* on the
 * server. Holds `initAuth` (the app's Better Auth instance) and, until the apps
 * migrate off Clerk (#218), `transformUserForClient` (maps a backend Clerk `User`
 * to the serializable shape sent to client components). Kept out of the
 * `'use client'` barrel in `./index.ts` so it executes server-side instead of
 * becoming a client reference. See docs/adr/0003-framework-agnostic-auth-seam.md.
 */
export { initAuth } from './init-auth';
export type { Auth, InitAuthOptions, Session } from './init-auth';

export * from './types/admin';
