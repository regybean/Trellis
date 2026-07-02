/**
 * Backend auth surface — no `'use client'` boundary, so it can *run* on the
 * server. Holds `transformUserForClient` (maps a backend Clerk `User` to the
 * serializable shape sent to client components). Kept out of the `'use client'`
 * barrel in `./index.ts` so it executes server-side instead of becoming a
 * client reference. See docs/adr/0003-framework-agnostic-auth-seam.md.
 */
export * from './types/admin';
