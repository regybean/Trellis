/**
 * Backend auth surface — no `'use client'` boundary, so it can *run* on the
 * server.
 *
 * Two things live here, and the split between them is the seam: `initAuth`
 * builds *the app's* Better Auth instance, and `./principal` turns whatever that
 * instance resolves into the neutral shapes the rest of the repo consumes —
 * `toPrincipal` for `@acme/trpc`'s `InjectedUser`, `readSessionRole` for the
 * role, `toManagementUser` for `@acme/ui`'s admin widget. Resolving a session
 * stays app-owned (Next.js middleware vs. a TanStack Start server function);
 * the mappings are provider-specific and shared by both full apps.
 *
 * See docs/adr/0034-better-auth-replaces-clerk.md and
 * docs/adr/0003-framework-agnostic-auth-seam.md.
 */
export { initAuth } from './init-auth';
export type { Auth, InitAuthOptions, Session } from './init-auth';

export * from './principal';
