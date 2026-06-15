# Auth is injected into the tRPC context; the app owns the Clerk resolver

Adding a second app (`apps/tanstack-start`) alongside `apps/nextjs` forced the
question of how features get the current user. Previously `@acme/trpc`'s
`createTRPCContext` called Clerk's `auth()` / `currentUser()` itself — bound to
`@clerk/nextjs/server`, which only runs under Next. Two decisions are
load-bearing:

1. **`createTRPCContext` accepts injected `auth` + `user`; it no longer resolves
   them.** The context takes an `InjectedAuth` (the resolved `userId` +
   `sessionClaims`) and a backend `User | null`, supplied by the caller. The
   subscription / tier / credits logic is unchanged (it only needs `userId`), and
   the `isAuthed` / `isAdmin` middleware still read `ctx.auth` /
   `ctx.auth.sessionClaims?.metadata.role`. The feature routers don't know which
   framework resolved the auth.

2. **Each app owns its Clerk resolver.** `@acme/auth` is neutral — it re-exports
   the framework-agnostic client surface from `@clerk/clerk-react` and a backend
   `transformUserForClient`. Each app picks the matching server SDK and resolves
   auth at its HTTP boundary, then injects it:
   - `apps/nextjs` resolves via `@clerk/nextjs/server` in its route handlers.
   - `apps/tanstack-start` resolves via `@clerk/tanstack-react-start/server`
     (`auth()` + `clerkClient().users.getUser`) in `src/lib/clerk-context.ts`,
     after registering `clerkMiddleware()` in `createStart()` (`src/start.ts`).

## Status

accepted

## Considered and rejected

- **Per-framework conditional imports inside `@acme/trpc`.** Branching on a
  runtime flag (or `package.json` `imports` conditions) to pick
  `@clerk/nextjs/server` vs. `@clerk/tanstack-react-start/server` would pull both
  SDKs into every feature's dependency graph and couple the platform layer to the
  set of frameworks we happen to support. Rejected — the platform layer should not
  know frameworks exist.
- **A Vite alias shim mapping `@clerk/nextjs/server` → the Start SDK.** A build-time
  alias would let the Next-shaped imports survive unchanged, but it hides the
  coupling in build config, breaks type-checking (the shapes differ), and only
  works for the bundler — not for `tsc` or tests. Rejected.

## Consequences

- `@acme/auth` drops its `next` / `@clerk/nextjs` dependencies; client feature
  imports (e.g. billing `useAuth`, the sidebar `UserButton`) repoint to `@acme/auth`.
- `createTRPCContext`'s signature gains `auth` + `user`. Every caller (both apps'
  route handlers) must resolve and pass them — there is no implicit fallback, so a
  missing resolver is a type error, not a silent unauthenticated context.
- `ctx.user` is a real backend Clerk `User` (the billing account router reads
  `primaryEmailAddress`), so the Start resolver fetches it via
  `clerkClient().users.getUser` when a `userId` is present.
- Route guards replace Next middleware in the Start app: `beforeLoad` calls a
  `getAuthState` server function and redirects unauthenticated / non-admin users.
- The neutral surface is split into two entry points so the Next RSC graph never
  evaluates client Clerk code: `@acme/auth` is a `'use client'` barrel
  re-exporting `@clerk/clerk-react` hooks/components, and `@acme/auth/server`
  holds the backend `transformUserForClient`. Without the client boundary, a
  server component importing the barrel pulls `@clerk/clerk-react` →
  `@clerk/shared` → `swr` into the server graph, where `swr` resolves via its
  `react-server` export condition (no default export / no `useSWR*`) and the
  build fails. Backend code (`transformUserForClient`) must stay out of the
  `'use client'` barrel because it has to *run* on the server, not become a
  client reference.
