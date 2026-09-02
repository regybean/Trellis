/**
 * The neutral, framework-free surface of the auth seam — and after ADR 0034 it
 * is only the global `InjectedUser`/`Roles` declarations that `@acme/trpc` and
 * the features merge into.
 *
 * There is nothing else to export because Better Auth ships no UI. Under Clerk
 * this barrel re-exported nine prebuilt components and hooks from
 * `@clerk/clerk-react` behind a `'use client'` directive, which is what made
 * `@acme/auth` a React package. Now the *app* owns the client
 * (`createAuthClient`), `@acme/ui` owns the presentation, and `@acme/hooks` owns
 * the client-side status seam — so this package ships no React at all, and the
 * slim apps' graph never sees an auth provider (ADR 0010).
 *
 * Server code lives in `@acme/auth/server`, the Drizzle tables in
 * `@acme/auth/schema`, and the signing secret in `@acme/auth/env`.
 */
export type * from './types/globals';
