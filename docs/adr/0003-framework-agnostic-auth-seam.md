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

## Amendment — the seam covered resolution, not the session type

Decision 1 above is narrower than it reads. Making `createTRPCContext` take an
injected `auth` moved _resolution_ into the app, but the _type_ it injected was
still Clerk's: `InjectedAuth` was `{ userId, sessionClaims: CustomJwtSessionClaims }`,
and `CustomJwtSessionClaims` — Clerk's JWT-claims augmentation point — had to be
declared in every program that touched a procedure. It was declared seven times:
`@acme/auth`, `@acme/trpc`, the `global.d.ts` of all four features, and the
feature generator template. So every feature carried the provider's session
vocabulary despite importing no Clerk SDK, a newly scaffolded feature inherited
it, and swapping providers would have touched all seven.

Issue #220 replaces it:

- `InjectedSession { user: InjectedUser | null }` is the whole of what the
  platform consumes, and `ctx.auth` + `ctx.user` collapse into `ctx.session`.
- `InjectedUser`'s base (in `@acme/trpc`) carries exactly what the substrate
  reads: a guaranteed `id` and an optional `role`. `isAdmin` gates on
  `ctx.session.user.role`; `isAuthed` re-injects the narrowed session, so a
  protected procedure's `ctx.session.user` is non-null. Because an admin implies
  a principal, `adminProcedure` narrows too — `@acme/ingest`'s local
  `requireUserId` guard, which existed only because the old union didn't narrow,
  is gone.
- The base is **declared once**. It lives in `@acme/trpc`'s `src/index.ts`, not
  a `global.d.ts` — `tsc` never re-emits a `.d.ts`, so a declaration file in
  `src` reaches nobody, which is why the old claims type had to be restated in
  every program. Declared in a module that _is_ emitted, it rides
  `dist/index.d.ts` into every consumer. Packages that need more augment the
  interface (`@acme/billing`'s primary email, `@acme/auth`'s for the full apps);
  nobody restates the base, so replacing the provider's session type cannot
  fan out the way `CustomJwtSessionClaims` did.
- `CustomJwtSessionClaims` is deleted everywhere, including the generator
  template. A scaffolded feature now names no auth provider at all: its
  `api/trpc.ts` delegates to `createFeatureTRPCWithDb` and its package.json
  drops `@clerk/nextjs`.
- `adminProcedure` stays in `@acme/trpc` rather than moving up into each app —
  all four features, both slim apps, the generator template and three test suites
  use it. Carrying `role` on the base principal is the price of keeping it.

The provider vocabulary now lives in two places, which is what "the seam is
app-owned" was meant to mean:

- **`@acme/auth`** holds the Clerk-shaped pieces: `readRole` (the single
  validated read of the role claim — Clerk types session claims as
  `{ [k: string]: unknown }`, so the shape is parsed, not asserted) and
  `toInjectedPrincipal`, the single Clerk→principal mapping. The mapping is
  _provider_-specific, not _framework_-specific, so both full apps share it;
  what stays app-owned is resolution — which SDK's `auth()` and user fetch to
  call. `toInjectedPrincipal` reads `primaryEmailAddress` off the real Clerk
  `User`, so a renamed provider field is a compile error in exactly one place,
  while the seam itself stays structural (typing the augmentation `Pick<User,
…>` instead would give the merged member two different types, since
  `@acme/billing` declares the same field without Clerk in scope).
- **The two full apps** resolve Clerk in their context resolvers and hand the
  results to `toInjectedPrincipal`, and read the role through `readRole` in the
  Next middleware admin gate, the Start route guard, and both admin
  server-action gates. The Clerk `User` instance itself no longer reaches the
  tRPC context; `@acme/billing` augments the seam with the one email field it
  reads, structurally.
- **Identity comes off the session, not the user fetch.** `protectedProcedure`
  has always gated on `auth().userId`, independently of `currentUser()`, so
  `toInjectedPrincipal` returns a principal whenever the session has a `userId`
  — a caller whose user fetch comes back empty still authenticates, and only
  billing's Stripe lookup notices the missing email.

The role still comes off the session token, so behaviour is unchanged — a role
change takes effect on token refresh, exactly as before.

Consequence: swapping Clerk for another provider is a change to `@acme/auth`
plus the two full apps. The slim apps show the floor — a constant
`{ user: { id: 'local', role: 'admin' } }` with no provider behind it
([ADR 0010](0010-slim-no-auth-apps.md)).

## Amendment 2 — the same split, under Better Auth (#239)

The amendment above claimed the mapping is _provider_-specific, not
_framework_-specific, so both full apps share it. Migrating the two apps
falsified that claim before restoring it: #237 and #238 ran in parallel off the
same base, and each wrote its own copy of the same three functions — a role
parse, a principal mapping and a Better Auth user → admin-widget adapter — one
of them app-local in `apps/nextjs/src/server/session.ts`. Two implementations of
one provider mapping is exactly the fan-out this ADR exists to prevent.

#239 collapses them. The line held is unchanged; only the provider moved:

- **`@acme/auth/server`** holds `readSessionRole`, `toPrincipal` and
  `toAdminUser`. All three are typed **structurally**, on the fields they
  read, because Better Auth types `getSession` as returning the core user columns
  only — the admin plugin's `role` is a runtime fact with no static promise
  behind it, which is why it is parsed rather than read. `readSessionRole` takes
  a user _row_, not `unknown`: the first version accepted anything, so passing a
  resolved `{ session, user }` compiled, failed its parse silently, and degraded
  every caller to non-admin.
- **The two full apps** resolve the session — Next.js middleware plus a route
  handler, a TanStack Start server function — and hand the result to those three.
  They also own `initAuth({ baseUrl })`, the mounted `/api/auth` handler,
  `createAuthClient`, and the guards.
- **The client half is new, and it is not here.** Clerk shipped hooks, so
  features read `useAuth()` out of `@acme/auth`. Better Auth's client is
  app-owned, so the neutral `AuthStatus` context lives in `@acme/hooks`
  (`AuthStatusProvider` / `useAuthStatus`) and each app maps its own
  `useSession` onto it. `@acme/auth` therefore ships no React at all — which is
  what keeps a provider out of the slim apps' graph
  ([ADR 0010](0010-slim-no-auth-apps.md)).
- **The seam is now enforced, not just described.** `banClerkServer` became
  `banBetterAuth` in `tooling/eslint/base.ts`: a runtime `better-auth` import
  fails lint everywhere except the two full apps and `@acme/auth`.

What changed behaviourally: the role is a **column**, not a JWT claim, so a role
change takes effect on the next request rather than on token refresh — sessions
are database rows and the cookie cache is off
([ADR 0034](0034-self-hosted-better-auth.md)).

## Amendment 3 — the principal is a concrete type (#250)

Amendment 1 got the seam right and the mechanism wrong. `InjectedSession` is
still the whole of what the platform consumes, `ctx.session` is still where the
app injects it, and the base still lives in `@acme/trpc`'s `src/index.ts`. What
goes is the `declare global` around it.

The augmentation existed to carry one field: `primaryEmailAddress:
{ emailAddress: string } | null`, which `@acme/billing` reads to open a Stripe
customer. That is Clerk's nested API shape. Under Better Auth the email is
`user.email: string`, so `toPrincipal` took a flat string and wrapped it back
into the dead vendor's object and billing's account router unwrapped it again,
between two packages we own.

The layering constraint that motivated an augmentable global is real:
`@acme/trpc` is platform and cannot import `@acme/auth` (shared). But it only
bites for a type platform cannot _name_. Platform can name `email: string`
perfectly well. It could never name Clerk's `User`, which is why the mechanism
arrived. That reason is gone.

- **`InjectedUser` is exported from `@acme/trpc` and imported like any other
  type**: `{ id: string; role?: Roles; email?: string }`. `email` is optional
  because the slim apps inject `{ id: 'local', role: 'admin' }` and drop billing
  entirely ([ADR 0010](0010-slim-no-auth-apps.md)).
- **Both augmentation files are deleted**, `@acme/billing`'s `src/global.d.ts`
  and `@acme/auth`'s `src/types/globals.d.ts`, along with the comments in three
  files warning that they had to be kept in agreement by hand, and the `| null`
  branch billing defended against that Better Auth's unique-key email cannot
  produce.
- **Both full apps' tsconfigs stop reaching across the workspace by relative
  path** to load the augmentation into their program.
- **`@acme/auth`'s `.` entrypoint is gone with it.** It shipped the global and a
  `Roles` re-export and nothing else, and nothing imported it. The package now
  exports `./server`, `./schema` and `./env`, which is what it actually has.

Why this is worth recording rather than treating as a tidy-up: amendment 1
argued the base would never need restating because consumers _augment_ rather
than redeclare. In practice features compile in isolation against `dist`, so an
augmentation in a feature is not merging into the platform's base at all. It is a
second declaration that only the app's program ever sees next to the first, and
nothing checked that the two agreed. A concrete exported interface gets checked
by the compiler at every import, which is what the original goal of "replacing
the provider's session type cannot fan out" actually needed.

## Amendment 4 — the injection point outlives its function (#264)

`createTRPCContext` is deleted, so the wording above that names it is stale: the
signature in decision 1 and its consequence at line 47, the reading of decision
1 in amendment 1, and amendment 2's note that a scaffolded feature's
`api/trpc.ts` "delegates to `createFeatureTRPCWithDb`". None of those functions
exist.

The seam itself does not move, which is why this is an amendment and not a
reversal. The app still resolves whoever is calling and still injects the result
at `ctx.session`; `@acme/trpc` still names no provider and depends on no auth
SDK; `InjectedSession` / `InjectedUser` are still the whole of what the platform
consumes. What changed is only which code holds the injection point:

- **The app's context resolver is the injection point.** Each app writes one
  `resolveContext(req)` (plus an entitlements-carrying variant) and hands it to
  `createTRPCFetchHandler` at each mount. That resolver's return value _is_
  `ctx` — `createTRPCContext` had become an identity function over it.
- **The check survives in a stronger form.** `createTRPCFetchHandler` infers the
  context from the `router` it is given and types `resolver` against it, so a
  mount whose feature reads a field the app's resolver doesn't produce fails to
  compile. That check used to be spelled out by threading the feature's
  `createTRPCContext` alongside the router.
- **A scaffolded feature builds its own tRPC instance.** `api/trpc.ts` calls
  `initTRPC.context<FeatureContext>().create(trpcConfig)` and wires the shared
  middleware bodies in four one-liners. It still names no auth provider, which
  was amendment 2's point.
- **`adminProcedure` still is not app-owned**, and `role` still rides the base
  principal for it — but the gate is now `requireAdmin`, a plain function in
  `@acme/trpc` that each feature wraps in its own `t.middleware`. The
  `@acme/auth` integration test that proves a promotion reaches that gate calls
  `requireAdmin` directly for the same reason: `shared` cannot import a
  feature's procedure, and hand-rolling one would test wiring no app runs.
