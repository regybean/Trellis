# Platform tRPC (`@acme/trpc`)

The single source of the tRPC initialization and request-pipeline middleware that
every feature reuses. It owns _how_ a request is authenticated, traced and timed
— not _what_ any feature does with it. It gates on nothing billing-related; that
moved to the feature that has tiers (ADR 0006 amendment, #250).

## Language

**Feature tRPC**:
The per-feature tRPC instance (router, procedures, context) produced by one call to
`createFeatureTRPC` or `createFeatureTRPCWithDb`. Each feature has exactly one.
_Avoid_: "the tRPC setup", "the router config"

**Base context**:
The request context every procedure receives — the app-injected `session` and the
injected `entitlements` provider, passed through. Assembling it does no I/O.
There is no `telemetry` on the context: telemetry is ambient (ADR 0023), and no
resolved billing state either (#250).
_Avoid_: "the request object", "the tRPC context object"

**Entitlements provider**:
The `EntitlementsProvider` (`@acme/entitlements`) injected into `createTRPCContext`
as `ctx.entitlements` — the billing seam. Required, with no implicit default
(ADR 0006): the full apps inject `@acme/subscriptions`'s `subscriptionsEntitlements`
(Stripe/Redis-backed), a no-billing build injects `unlimitedEntitlements`. The
substrate names no billing implementation — it depends only on the neutral contract.
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
The `InjectedSession` an app resolves at its edge and passes to
`createTRPCContext` — `{ user: InjectedUser | null }`. `InjectedUser` is a
concrete exported interface, `{ id, role?, email? }`: the substrate reads `id`
and `role`, and `email` is there because `@acme/billing` opens a Stripe customer
against it (optional, since the slim apps inject a constant principal and drop
billing — ADR 0010). It was an augmentable global until #250, which is worth
knowing only because the field it carried named Clerk. No auth provider is named
here; mapping a provider's session onto this shape is the app's job (ADR 0003).
_Avoid_: "the auth object", "the provider session"

**Protected procedure**:
A procedure requiring a principal — `isAuthed` rejects a null `ctx.session.user`
and re-injects the narrowed session, so downstream `ctx.session.user` is non-null.

**Admin procedure**:
A procedure requiring `ctx.session.user.role === 'admin'` (`isAdmin`). An admin
implies a principal, so this narrows `ctx.session.user` too.

**Context resolver**:
The app-owned function that turns an HTTP `Request` into the neutral context input
`createTRPCContext` expects, mapping its auth provider's session onto the
**Injected session** (a resolved Better Auth session for the full apps; a constant
local principal for the slim apps). The _only_ per-app/per-framework piece of the route seam — it stays
in the app to keep framework + auth specifics out of the platform (ADR 0003 / 0010).
_Avoid_: "the auth handler", "the context builder"

**tRPC route handler factory** (`@acme/trpc/handler`):
`createTRPCFetchHandler({ endpoint, router, createContext, resolver })` — the
framework-parametric fetch-adapter wiring (with `logTRPCError` baked in) every app
shares. Apps feed it their **Context resolver** and compose the result into their
framework's handler shape. `corsPreflightHeaders` is the single source of the CORS
policy; the trivial 204 `Response` is built at each app's `OPTIONS` seam.

## Relationships

- A **Feature tRPC** is produced by either `createFeatureTRPC()` (no DB) or
  `createFeatureTRPCWithDb(db)` (DB-backed)
- `createFeatureTRPCWithDb` instruments the Drizzle client for OpenTelemetry and
  injects it as `ctx.db` (typed to the feature's schema `TDb`) via a middleware on
  every procedure
- Every procedure receives the **Base context**
- **Admin procedure** and **Protected procedure** build on the public procedure (telemetry + timing middleware)
- The telemetry middleware creates and _activates_ the per-procedure span; the other
  middlewares emit their events through the active span read ambiently via
  `trace.getActiveSpan()`, not through `ctx` (ADR 0023)
- A procedure that meters or gates on billing performs its own **Entitlements
  resolution** — `@acme/billing`'s `requireTier` and account router, `@acme/chat`'s
  `send` and `reconcileTurn`. No middleware here does

## Design decisions

**Billing is injected, not imported** (ADR 0006): `createTRPCContext` takes a required
`entitlements` provider rather than importing `@acme/subscriptions` (and its Redis
connections) directly. This keeps the substrate — and therefore every feature that
reuses it — free of a billing dependency, so a no-billing app injects
`unlimitedEntitlements` and gets unmetered chat rather than a Basic tier's 250
credits against a Stripe account it does not have. A missing provider is a type
error, not a silent default (mirroring the auth seam).

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

**Two factories instead of one generic**: a generic context parameter
(`initTRPC.context<TContext>()`) makes tRPC's middleware conditional types explode.
The core tRPC instance is built against a _concrete_ `BaseContext`; the DB variant
layers `ctx.db` on via a middleware whose only generic surface is a simple `{ db: TDb }`
context override. This keeps the type machinery shallow and the build fast.

**DB is caller-created**: features instantiate their own Drizzle client (from their own
env/schema) and pass it to `createFeatureTRPCWithDb`. The factory instruments it and
injects it; features own the connection config and schema.

**Handler plumbing lives once, the resolver stays in the app**: the fetch-adapter
wiring, `logTRPCError`, and the CORS policy are substrate, not auth — they live in
`@acme/trpc/handler` so they can't drift per-app (they had: one app hand-rolled
`console.error` and never depended on `@acme/trpc`; another omitted the OPTIONS
handler). Only the **Context resolver** — which _is_ auth/framework-specific — stays
app-owned, satisfying ADR 0003 / 0010. A fifth framework writes one resolver, not the
whole handler. The 204 `Response` is built in each app because the `Response` global is
framework-runtime-provided (Next vs TanStack/Nitro) and crosses a Node-vs-DOM type
boundary if constructed in the platform package.

**`@acme/trpc/testing` is the one home for a test caller context**: `createTestContext`
(+ `createMockEntitlements`, `createMockSession`)
live here — beside the `BaseContext` they must match — so every feature builds a caller
from the real platform types, not the structural `as any` a tooling package below
`platform` was forced into. It's a tree-shaken export subpath; prod never imports it.
The context carries exactly what production's carries — session + provider, nothing
resolved — and the tier/credit knobs feed the mock provider a test's procedure
resolves through, so a test context cannot drift from production. See
[docs/TESTING.md](../../../docs/TESTING.md).

**The feature supplies the principal, this package supplies everything else**:
`createTestContext` takes `user: InjectedUser` whole rather than a `userId` +
`role` it fakes a principal from, because which fields matter is the feature's
knowledge — billing's tests need an `email` for the Stripe customer lookup; the
other three need identity and role. Each feature's
`tests/backend/utils/test-context.ts` wraps this builder and maps the
`FeatureTestContextOptions` its tests pass (`userId`, `role`, `tier`, `credits`)
onto its own principal.
