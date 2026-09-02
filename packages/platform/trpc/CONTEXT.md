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
The neutral half of the request context every procedure receives — the request
plus the app-injected `session`, passed through (`ContextOpts`). Assembling it
does no I/O. There is no `telemetry` on the context: telemetry is ambient
(ADR 0023). There is no billing on it either, resolved or otherwise (#250, #256).
_Avoid_: "the request object", "the tRPC context object"

**Context extension**:
The per-request values one feature needs beyond the **Base context**, declared by
that feature as a type parameter to `createFeatureTRPC` / `createFeatureTRPCWithDb`
and merged into every one of its procedures' `ctx`. The substrate carries it and
names none of its fields. `@acme/billing`'s `BillingContext` and `@acme/chat`'s
`ChatContext` are both `{ entitlements: EntitlementsProvider }`; `@acme/feedback`
and `@acme/ingest` declare none, and the parameter defaults to that (#256, ADR 0006
amendment).
_Avoid_: "the custom context", "extra ctx fields"

**Entitlements provider**:
The `EntitlementsProvider` (`@acme/entitlements`) a feature that meters or gates
names in its **Context extension**, reaching `ctx.entitlements` — the billing
seam. Required by those features, with no implicit default (ADR 0006): the full
apps inject `@acme/subscriptions`'s `subscriptionsEntitlements` (Stripe/Redis-backed),
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
- Every procedure receives the **Base context**, plus its feature's **Context extension**
- **Admin procedure** and **Protected procedure** build on the public procedure (telemetry + timing middleware)
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

**Whose context it is, is the feature's call** (#256): the provider used to be a
required field _here_, on every context. Constructing one therefore meant importing
the billing contract, in `@acme/feedback`, in `@acme/ingest`, in both slim apps,
none of which has a tier or a credit. Nothing in the substrate had read it since
#250, so the field bought nothing but the coupling. It is now a **Context
extension**. Billing and chat declare the provider they resolve against, the other
two declare nothing, and `@acme/entitlements` is not a dependency of this package.

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

**Generic in the extension, concrete in the base, every middleware inline**:
`initTRPC.context<ContextOpts & TExtension>()` leaves tRPC's `ContextCallback`
conditionals unresolved, and the `MiddlewareBuilder` a standalone `t.middleware(fn)`
produces then stops being assignable to what `.use` wants. The two only agree once
the context is concrete. Passed _inline_ to `.use`, the arrow is contextually typed
and the two are never compared, so the middleware bodies live in plain helpers
(`withProcedureSpan`, `withTimingLog`, `requirePrincipal`, `requireAdmin`) that the
one-line arrows delegate to. That is the whole cost of the type parameter, and it
reads better than what it replaced: the span lifecycle and the auth gates are
ordinary functions now, with no tRPC types in them. The base half stays concrete so
those gates still narrow `ctx.session.user` against a real type. Declaration emit
needs one more thing, a type import naming
`@trpc/server/unstable-core-do-not-import`, without which the builder type is
unnameable (TS2742).

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

**`@acme/trpc/testing` is the one home for a test caller context**:
`createTestContext` (+ `createMockSession`) lives here — beside the `ContextOpts`
it must match — so every feature builds a caller from the real platform types, not
the structural `as any` a tooling package below `platform` was forced into. It's a
tree-shaken export subpath; prod never imports it. It takes the same **Context
extension** type parameter `createTRPCContext` does and merges it the same way, so
a test context cannot drift from production. The mock `EntitlementsProvider` moved
out with the contract, to `@acme/entitlements/testing` (#256). See
[docs/TESTING.md](../../../docs/TESTING.md).

**The feature supplies the session, this package supplies the defaults**:
`createTestContext` takes `session` whole rather than a `userId` + `role` it fakes
a principal from, because which fields matter is the feature's knowledge — billing's
tests need an `email` for the Stripe customer lookup; the other three need identity
and role. It is nested under `session` rather than a bare `user` so that every key
a test passes is a key the real context has, which is what lets the extension merge
straight through. Each feature's `tests/backend/utils/test-context.ts` wraps this
builder, maps the `FeatureTestContextOptions` its tests pass (`userId`, `role`) onto
its own principal, and adds its extension — for chat and billing that means
`entitlements: createMockEntitlements({ tier, credits })`.
