# Platform tRPC (`@acme/trpc`)

The single source of the tRPC runtime config and request-pipeline middleware that
every feature reuses. It owns _how_ a request is authenticated, traced and timed
— not _what_ any feature does with it. It gates on nothing billing-related; that
moved to the feature that has tiers (ADR 0006 amendment, #250). It builds no tRPC
instance of its own either; that moved to the feature that has a context (#264).

## Language

**Feature tRPC**:
The per-feature tRPC instance (router, procedures, context) a feature creates in
its own `api/trpc.ts` with `initTRPC.context<FeatureContext>().create(trpcConfig)`.
Each feature has exactly one, and composes the shared middleware onto it in four
one-line `t.middleware` calls.
_Avoid_: "the tRPC setup", "the router config"

**Base context**:
The neutral half of the request context every procedure receives — the request
plus the app-injected `session` (`BaseContext`). Assembling it does no I/O. There
is no `telemetry` on the context: telemetry is ambient (ADR 0023). There is no
billing on it either, resolved or otherwise (#250, #256). There is no `db` on it
either: a feature imports its own (#264).
_Avoid_: "the request object", "the tRPC context object"

**Feature context**:
The whole of one feature's request context — a `BaseContext` the feature extends
with whatever else its procedures read, named in that feature's `api/trpc.ts` and
handed to `initTRPC.context<…>()`. `@acme/billing`'s `BillingContext` and
`@acme/chat`'s `ChatContext` both add `{ entitlements: EntitlementsProvider }`;
`@acme/feedback`, `@acme/ingest` and `@acme/notifications` add nothing, so theirs
is `BaseContext` under a feature-local name (#256, ADR 0006 amendment). It was a
type parameter on a substrate factory until #264, which is worth knowing only
because it explains what the deleted `TExtension` was.
_Avoid_: "the context extension", "the custom context", "extra ctx fields"

**Entitlements provider**:
The `EntitlementsProvider` (`@acme/entitlements`) a feature that meters or gates
names on its **Feature context**, reaching `ctx.entitlements` — the billing seam.
Required by those features, with no implicit default (ADR 0006): the full apps
inject `@acme/subscriptions`'s `subscriptionsEntitlements` (Stripe/Redis-backed),
a no-billing build injects `unlimitedEntitlements`. This package names neither the
implementation nor the contract — it doesn't depend on `@acme/entitlements` at all.
_Avoid_: "the billing service", "the subscription client"

**Entitlements resolution**:
The `subscription` / `tier` / `credits` triple a procedure gets by calling
`ctx.entitlements.resolve(userId)` on the injected **Entitlements provider** —
never by importing a billing package into the substrate. Resolved by the
procedures that read it (billing's tier gate and account router, chat's `send`
and `reconcileTurn`), not by the substrate on every request: it costs 2-4 Redis
round-trips, and most procedures never look at it.
_Avoid_: "the billing context" — nothing assembles one up front.

**Injected session**:
The `InjectedSession` an app resolves at its edge and puts on the context it
builds — `{ user: InjectedUser | null }`. `InjectedUser` is a concrete exported
interface, `{ id, role?, email? }`: the gates read `id` and `role`, and `email` is
there because `@acme/billing` opens a Stripe customer against it (optional, since
the slim apps inject a constant principal and drop billing — ADR 0010). It was an
augmentable global until #250, which is worth knowing only because the field it
carried named Clerk. No auth provider is named here; mapping a provider's session
onto this shape is the app's job (ADR 0003).
_Avoid_: "the auth object", "the provider session"

**Protected procedure**:
A procedure requiring a principal — `requirePrincipal` rejects a null
`ctx.session.user` and the middleware re-injects the narrowed session, so
downstream `ctx.session.user` is non-null.

**Admin procedure**:
A procedure requiring `ctx.session.user.role === 'admin'` (`requireAdmin`). An
admin implies a principal, so this narrows `ctx.session.user` too.

**Context resolver**:
The app-owned function that turns an HTTP `Request` into a **Feature context**,
mapping its auth provider's session onto the **Injected session** (a resolved
Better Auth session for the full apps; a constant local principal for the slim
apps). Each app exports one per context shape it can build — `resolveContext` and
`resolveContextWithEntitlements` — and each mount names the one it needs. The
_only_ per-app/per-framework piece of the route seam; it stays in the app to keep
framework + auth specifics out of the platform (ADR 0003 / 0010).
_Avoid_: "the auth handler", "the context builder"

**tRPC route handler factory** (`@acme/trpc/handler`):
`createTRPCFetchHandler({ endpoint, router, resolver })` — the framework-parametric
fetch-adapter wiring (with `logTRPCError` baked in) every app shares. The
resolver's return type is pinned to the router's own context, so a mount handed a
resolver that doesn't build what the feature reads fails to compile. Apps compose
the result into their framework's handler shape. `corsPreflightHeaders` is the
single source of the CORS policy; the trivial 204 `Response` is built at each
app's `OPTIONS` seam.

## Relationships

- A **Feature tRPC** is created by the feature, from this package's `trpcConfig`
  plus its own **Feature context** type
- The four middleware bodies — `withProcedureSpan`, `withTimingLog`,
  `requirePrincipal`, `requireAdmin` — live here as plain functions with no tRPC
  types in them; each feature wraps them in `t.middleware` and stacks them
- Each body takes only what it logs or decides on. `withTimingLog` reads
  `NODE_ENV` itself rather than taking an `isDev` flag, so "how do we detect
  dev" is not a fact five features and the generator template each restate by
  reaching into tRPC's private `t._config`
- Every procedure receives its feature's **Feature context**, whole — there is no
  merge step and nothing the substrate adds
- **Admin procedure** and **Protected procedure** build on a public procedure
  (telemetry + timing middleware) that each feature keeps unexported — every
  procedure in the tree today is gated, so the base is a local, not a surface
- The telemetry middleware creates and _activates_ the per-procedure span; the other
  middlewares emit their events through the active span read ambiently via
  `trace.getActiveSpan()`, not through `ctx` (ADR 0023)
- A procedure that meters or gates on billing performs its own **Entitlements
  resolution** — `@acme/billing`'s `requireTier` and account router, `@acme/chat`'s
  `send` and `reconcileTurn`. No middleware here does

## Design decisions

**Billing is injected, not imported** (ADR 0006): a feature that meters or gates
takes an `entitlements` provider on its context rather than importing
`@acme/subscriptions` (and its Redis connections) directly. So a no-billing app
injects `unlimitedEntitlements` and gets unmetered chat rather than a Basic tier's
250 credits against a Stripe account it does not have. A missing provider is a type
error, not a silent default (mirroring the auth seam).

**Whose context it is, is the feature's call** (#256, #264): the provider used to
be a required field _here_, on every context. Constructing one therefore meant
importing the billing contract, in `@acme/feedback`, in `@acme/ingest`, in both
slim apps, none of which has a tier or a credit. #256 moved it out to a type
parameter the substrate carried and never read; #264 finished the job by deleting
the parameter and letting each feature name its whole context. Billing and chat
name the provider they resolve against, the other three name `BaseContext`, and
`@acme/entitlements` is not a dependency of this package. The apps supply a
matching context per mount rather than per app: each mount names one of its app's
resolvers, checked against that router's context, so a mount handed the wrong one
is a compile error.

**The substrate passes entitlements through and never reads them** (#250): it used
to `await entitlements.resolve()` for every request, so a `feedback` mutation or a
read-only chat query paid 2-4 Redis round-trips for state it never touched — and
the one router that did read it re-resolved anyway. Selection is per deployment
(the app picks the provider); resolution is per procedure (the four that spend,
refund or report credits). Nothing in between needs to do either.

**Telemetry is ambient** (ADR 0023): there is no `telemetry` on the context. The telemetry
middleware is the sole span source — it creates and activates the per-procedure span, and
everything else reads it via `trace.getActiveSpan()`. This removes the `BaseContext`-typing
blocker that a threaded telemetry object once imposed, with no generic and no
conditional-type explosion.

**Export the pieces; the feature builds the instance** (#264): this package used
to own `initTRPC` behind `createFeatureTRPC` / `createFeatureTRPCWithDb`, generic
in the feature's half of the context. A generic context leaves tRPC's
`ContextCallback` conditionals unresolved, so every middleware had to be an inline
arrow (a standalone `t.middleware(fn)` stops being assignable to what `.use`
wants), and declaration emit needed a type import naming
`@trpc/server/unstable-core-do-not-import` to dodge TS2742 — a subpath tRPC marks
private, in the file #219 measures as this bank's most-diverged. So the package
exports `trpcConfig` and the four middleware bodies instead, and each feature
writes about twenty lines against a context with no type parameter in it:
`t.middleware()` composes normally, the private subpath is gone, and a feature's
context is declared and consumed in one file.

The counter-argument, recorded because it is real: a factory cannot drift and
hand-written wiring can. The apps _did_ drift before `handler.ts` existed (one
hand-rolled `console.error` and missed structured logging; another omitted
`OPTIONS` entirely), and middleware ordering could go the same way. The judgement
is that twenty lines that typecheck, generator-templated, are a smaller risk
surface than a private tRPC subpath and an inline-arrow rule nothing enforces.
Everything that _can't_ typecheck its way out of drift — the fetch handler, error
logging, CORS — still lives here.

**The feature owns its database** (#264): a feature creates its Drizzle client
(from its own env/schema), instruments it with `instrumentDrizzleClient`, and its
routers import it. It used to be injected as `ctx.db` by a second factory, three
lines below the `export const db` the feature already published — and tests
imported that export directly rather than swapping the context, so `ctx.db` was
never the seam it looked like.

**Handler plumbing lives once, the resolver stays in the app**: the fetch-adapter
wiring, `logTRPCError`, and the CORS policy are substrate, not auth — they live in
`@acme/trpc/handler` so they can't drift per-app (they had: one app hand-rolled
`console.error` and never depended on `@acme/trpc`; another omitted the OPTIONS
handler). Only the **Context resolver** — which _is_ auth/framework-specific — stays
app-owned, satisfying ADR 0003 / 0010. A fifth framework writes one resolver, not the
whole handler. The 204 `Response` is built in each app because the `Response` global is
framework-runtime-provided (Next vs TanStack/Nitro) and crosses a Node-vs-DOM type
boundary if constructed in the platform package.

**`@acme/trpc/testing` is the one home for a test caller context**:
`createTestContext` (+ `createMockSession`) lives here — beside the `BaseContext`
it must match — so every feature builds a caller from the real platform types, not
the structural `as any` a tooling package below `platform` was forced into. It's a
tree-shaken export subpath; prod never imports it. It takes whatever a feature's
**Feature context** adds on top of `BaseContext` and merges it the same way an app
resolver does, so a test context cannot drift from production. The mock
`EntitlementsProvider` moved out with the contract, to `@acme/entitlements/testing`
(#256). See [docs/TESTING.md](../../../docs/TESTING.md).

**The feature supplies the session, this package supplies the defaults**:
`createTestContext` takes `session` whole rather than a `userId` + `role` it fakes
a principal from, because which fields matter is the feature's knowledge — billing's
tests need an `email` for the Stripe customer lookup; the other three need identity
and role. It is nested under `session` rather than a bare `user` so that every key
a test passes is a key the real context has, which is what lets the extra fields
merge straight through. Each feature's `tests/backend/utils/test-context.ts` wraps
this builder, maps the `FeatureTestContextOptions` its tests pass (`userId`,
`role`) onto its own principal, and adds the rest of its context — for chat and
billing that means `entitlements: createMockEntitlements({ tier, credits })`.
