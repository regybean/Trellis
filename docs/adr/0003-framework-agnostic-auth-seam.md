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
  `'use client'` barrel because it has to _run_ on the server, not become a
  client reference.
- The seam is guarded by ESLint (`no-restricted-imports` in
  `tooling/eslint/base.ts`): `@clerk/nextjs/server` and
  `@clerk/tanstack-react-start/server` are banned in every package by default;
  apps opt back in via `containmentOverride({ allowClerk: true })`. `@acme/auth`
  needs no exception — it uses `@clerk/clerk-react` / `@clerk/backend`, not the
  framework server SDKs. Type-only imports are allowed (they don't couple
  runtime).
- **One blessed feature-level exception:** `@acme/billing` ships a Next-coupled
  RSC (`stripe-success-handler.tsx`, exported only via `@acme/billing/server-next`,
  never the neutral `@acme/billing/server`). It resolves Clerk directly and
  carries an inline `eslint-disable` citing this ADR. This is a _named_ Next
  adapter living in the package, not a leak into the neutral surface — the
  TanStack app reimplements the same flow with a server function over
  `syncStripeDataToKV`. Any future feature-level Clerk use must clear the same
  bar (isolated behind a framework-specific entry point) or be injected instead.

## Amendment (#220) — the injected type is a neutral session, not the provider's

The decision above was half right. Resolution _was_ app-owned: each app called
its own Clerk SDK and injected the result, and no feature imported a framework
Clerk SDK. But the **shape** injected was Clerk's, not ours:

- `InjectedAuth` was `{ userId, sessionClaims: CustomJwtSessionClaims }` — the
  Clerk session object, chosen precisely so an app could pass `await auth()`
  straight through. That structural convenience is what made it Clerk's type.
- `CustomJwtSessionClaims` is a _Clerk_ global, and the platform declared it, as
  did `@acme/auth`, all four feature `global.d.ts` files, and the feature
  generator template — seven declarations of provider vocabulary in layers that
  ADR 0003 claimed knew nothing about the provider.
- `isAdmin` read the role off a JWT claim, which only exists because Clerk
  projects `public_metadata` into the session token.

So "the platform doesn't know frameworks exist" held, while "the platform
doesn't know _providers_ exist" did not. Swapping the provider would have
touched every one of those seven files.

The injected type is now neutral:

```ts
export type InjectedSession = { user: InjectedUser } | { user: null };
```

`ctx.auth` and `ctx.user` collapse into a single `ctx.session`. `InjectedUser`
stays the augmentable global, and the platform's base declares the only two
fields it reads: `id` and an optional `role`. `isAdmin` reads
`ctx.session.user.role`. Written as a union rather than
`{ user: InjectedUser | null }` so it narrows — once `isAuthed` has rejected the
signed-out case, `ctx.session.user` is non-null downstream, which is what let
`@acme/ingest` delete the `requireUserId` guard it had needed.

Consequences:

- **Mapping, not pass-through, is the app's job.** A resolver can no longer hand
  the platform its provider's session object; it maps onto `InjectedSession`
  explicitly. This is the honest seam — and it is now the only provider-shaped
  code in the request path.
- **`CustomJwtSessionClaims` moves to the apps.** It survives only in
  `apps/nextjs/src/global.d.ts` and `apps/tanstack-start/src/global.d.ts`, beside
  the Clerk adapters that read it, and it goes away with Clerk. Provider
  vocabulary lives with the adapter that owns it, not in `@acme/auth` or
  `@acme/trpc`.
- **Role is a field, not a claim.** Where it comes from is the app's business:
  under Clerk the resolvers still read `sessionClaims.metadata.role` and attach
  it to the injected user, so behaviour is unchanged; under a provider that
  stores role on the user row it is read directly.
- **The slim apps get simpler**, which is the check that ADR 0010 holds: their
  constant principal is `{ user: { id: 'local', role: 'admin' } }`, with no
  provider shape left to fake.

This amendment is a prefactor — it lands with Clerk still installed and every
behaviour identical. It exists so that replacing the provider (#218) touches
`@acme/auth` and the two full apps, and nothing else.
