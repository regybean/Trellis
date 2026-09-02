/**
 * Backend auth surface — no `'use client'` boundary, so it can *run* on the
 * server. Holds `initAuth` (the app's Better Auth instance) and `toPrincipal`
 * (the Better Auth session → neutral `InjectedUser` mapping both full apps
 * share), plus, until the apps finish migrating off Clerk (#218),
 * `transformUserForClient` (maps a backend Clerk `User` to the serializable
 * shape sent to client components), `toInjectedPrincipal` and `readRole` (the
 * validated read of the role *claim* off a Clerk session). Kept out of the
 * `'use client'` barrel in `./index.ts` so it executes server-side instead of
 * becoming a client reference. See docs/adr/0034-better-auth-replaces-clerk.md
 * and docs/adr/0003-framework-agnostic-auth-seam.md.
 */
export { initAuth } from './init-auth';
export type { Auth, InitAuthOptions, Session } from './init-auth';

export * from './principal';
export * from './session';
export * from './types/admin';
