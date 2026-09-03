# Billing is injected into the tRPC context as an `EntitlementsProvider`

**Status:** accepted

The auth seam ([ADR 0003](0003-framework-agnostic-auth-seam.md)) made the
_current user_ an injected value, but billing stayed hard-wired: `@acme/trpc`'s
`createTRPCContext` imported `@acme/subscriptions` directly (Redis + Stripe env)
to read the caller's subscription, tier, and credit balance. Because every
feature reuses the platform tRPC substrate, that single import pulled billing —
and its Stripe environment requirement — into _every_ feature's dependency
graph. Dropping the `@acme/billing` _feature_ was already trivial (just don't
mount its router); the real coupling lived one layer down, in the substrate.

This blocked a no-billing deployment (e.g. a single-user `nextjs-slim` app):
features loaded `@acme/trpc`, which loaded `@acme/subscriptions`, whose `env.ts`
demands `NEXT_PUBLIC_STRIPE_*_PLAN_ID` at import time. The coupling was visible
in tests, which had to `vi.mock('@acme/subscriptions')` to construct a context
at all.

> **That env problem is fixed, and it is no longer why the seam exists.**
> @acme/env ADR 0001 moved the Stripe variables into `@acme/billing`'s env and made plan
> ids an injected argument, so a direct import would no longer demand Stripe keys
> of anyone. The seam still holds, for two different reasons. See the
> [#250 amendment](#amendment-250--the-substrate-stops-reading-billing) before
> concluding the decision has expired — and the
> [#256 amendment](#amendment-256--the-context-extension-is-the-features-to-declare)
> for where the provider is declared now, which is no longer `@acme/trpc`.

Two decisions are load-bearing, mirroring the auth seam:

1. **The platform depends on a neutral contract, not an implementation.** A new
   `@acme/entitlements` package owns the `EntitlementsProvider` interface plus
   the relocated value types (`SubscriptionTier`, `SubscriptionCache`,
   `CreditBalance`, `Entitlements`, `isTierAtLeast`). It is pure — no Redis, no
   Stripe, no env, no IO. `@acme/trpc` imports only this contract; its
   `rateLimit` and `requireTier` middleware call `ctx.entitlements.resolve` /
   `.consume` / `.isTierAtLeast` instead of reaching into `@acme/subscriptions`.

2. **The app injects a concrete provider into `createTRPCContext` — required,
   with no implicit default.** `@acme/subscriptions` keeps all its Redis/Stripe
   logic and now _implements_ the contract via a `subscriptionsEntitlements`
   adapter. A no-billing build injects `unlimitedEntitlements` from
   `@acme/entitlements` (top tier, infinite credits, no-op `consume`). A missing
   provider is a type error, not a silent default.

## Considered and rejected

- **A build-time injected provider (like the `db` seam).** `@acme/trpc`'s
  `createFeatureTRPCWithDb(db)` injects the database once at feature-build time.
  Billing is different: it is an _app-swappable_ policy (Stripe vs. unlimited),
  not a feature-owned constant, so it belongs on the per-request context next to
  `auth` — the same shape, the same injection point. Adding a second injection
  style for an app-swappable dependency would fork the one pattern the repo
  already has. Rejected.
- **An optional `entitlements` with an `unlimited` fallback.** Defaulting to
  unlimited when omitted would make a forgotten provider silently grant every
  caller Pro — the billing equivalent of a silent unauthenticated context.
  Rejected for the same reason the auth seam has no fallback: the deployment
  must _choose_.
- **A new `Unlimited` tier.** The no-billing provider returns the existing top
  tier (`Pro`) so `requireTier` admits every caller without a new enum member
  rippling through the tier ordering, the Stripe adapter, and billing's UI.
  Rejected — reuse `Pro`.
- **Keeping the Zod `SubscriptionCacheSchema` in `@acme/entitlements`.** The
  _type_ `SubscriptionCache` is neutral and moves to the contract, but the Zod
  schema validates Stripe-shaped data and stays in `@acme/subscriptions` (its
  only producer). A conformance assertion guards the type and schema against
  drift. The contract package stays IO/dependency-free.

## Consequences

- **`@acme/trpc` drops three dependencies**: `@acme/subscriptions`, `@acme/redis`
  (a phantom dependency it never imported directly), and `@clerk/backend`.
  the principal is typed via an augmentable `InjectedUser` global (declaration
  merging) rather than a backend Clerk `User` import, so the substrate no longer
  names Clerk at all. (It reached the context as `ctx.user` when this ADR was
  written; it is `ctx.session.user` since #220 — see
  [ADR 0003](0003-framework-agnostic-auth-seam.md), amendment.)
- **`createTRPCContext`'s signature gains a required `entitlements`.** Every
  caller supplies one: both apps' route handlers and the TanStack `clerk-context`
  resolver inject `subscriptionsEntitlements`; the reference RSC callers in chat
  and ingest take it as a parameter; a no-billing app injects
  `unlimitedEntitlements`.
- **chat and ingest depend on no billing or Clerk SDK.** Their `trpc/server.tsx`
  RSC callers became neutral factories (`createServerTRPC({ headers, auth, user,
entitlements })`); `@clerk/nextjs` and `@acme/subscriptions` left their
  `package.json`. `@acme/billing` remains legitimately coupled to Clerk + Stripe
  (its account router reads the principal's `primaryEmailAddress`; its success handler
  resolves `auth()`), so it keeps those deps and its `server.tsx` stays a
  concrete worked example.
- **Tests no longer mock `@acme/subscriptions`.** Removing the
  `vi.mock('@acme/subscriptions')` hack from chat/ingest setups is the canary
  proving the env coupling is gone; test contexts inject a structural mock
  provider from `@acme/test-utils` instead.
- **A no-billing app is now "inject `unlimitedEntitlements` + a constant
  principal, mount chat + ingest"** — no feature changes, the slice contract
  preserved.

## Amendment (#109) — the Credit ledger is unified behind the seam

The original decision routed only the **read** and **consume** of credits
through the provider; the **refund** still reached into `@acme/subscriptions`
directly (`@acme/chat`'s `refundTurnCredits` imported `credits.refund`). A Credit
therefore crossed two different boundaries depending on direction — a latent
re-coupling of the substrate to billing. This amendment closes it; there is **no
observable product behaviour change**.

- **`refund(userId, tier, amount)` joins the `EntitlementsProvider` contract**,
  symmetric with `consume`. `subscriptionsEntitlements.refund` delegates to the
  Redis-backed `credits.refund`; `unlimitedEntitlements.refund` is a no-op (a
  no-billing deployment charged nothing, so it refunds nothing — without
  importing `@acme/subscriptions`).
- **The chat Generation worker's processor becomes a factory**,
  `createChatGenerationProcessor(entitlements)`, closing over an injected
  `EntitlementsProvider`. The request-less worker now refunds through the **same**
  seam the request path does. Each app's `worker.ts` injects the exact provider
  its route handler injects: full apps `subscriptionsEntitlements`, slim apps
  `unlimitedEntitlements` — the same 2×2 injection ADR 0010 proves for the
  request path, extended to the worker.
- **`refundTurnCredits` takes the provider's `refund` as a parameter**; its
  `chat:refunded:{turnId}` `SET NX` idempotency guard stays **local to the chat
  control plane** (`chat-turn-lifecycle.ts`) — it is a chat concern, not a
  provider one. `chat.reconcileTurn` supplies `ctx.entitlements.refund`; the
  worker supplies its injected provider's `refund`.
- **`@acme/chat` drops its direct dependency on `@acme/subscriptions`.** With
  both consume and refund behind the seam, chat imports no billing
  implementation at all — the canary that proves the seam holds, exactly as
  removing `vi.mock('@acme/subscriptions')` was the canary for the original
  decision. Chat's `SubscriptionTier`/`EntitlementsProvider` types now come from
  `@acme/entitlements` (the contract), not the adapter.
- **Credit-path doc reconciliation.** Chat's credit consume happens **inline in
  `chat.send`** — it guards on `ctx.credits.remaining` then calls
  `ctx.entitlements.consume` after ownership + the In-flight lock — **not** via
  the `rateLimit()` middleware. The middleware still exists in `@acme/trpc` for
  features that want per-procedure metering, but the chat control plane meters
  itself so a rejected send consumes nothing and the lock is released on
  exhaustion. This ADR's original prose named `rateLimit` as the consume path;
  for the chat slice that is now the inline call.

The tests reflect the same canary: the chat caller/worker harnesses inject the
structural mock provider (a no-op `refund`), so the credit **balance** movement
is asserted only in `@acme/subscriptions` (a real-Redis service test that
`subscriptionsEntitlements.refund` delegates to `credits.refund`); chat asserts
the control-plane contract it owns (the `refunded` result and the
`chat:refunded:{turnId}` guard) and that the error→refund path crosses the
injected provider.

## Amendment (#250) — the substrate stops reading billing

The seam holds and the injection point does not move: `createTRPCContext` still
takes a required `entitlements` provider, and a deployment still chooses between
`subscriptionsEntitlements` and `unlimitedEntitlements`. What changes is that
`@acme/trpc` no longer _reads_ through it.

- **`createTRPCContext` does no I/O.** It used to `await entitlements.resolve()`
  before any procedure ran, so every tRPC call in both full apps paid 2-4 Redis
  round-trips for a billing context most procedures never touched. That is every
  `feedback` mutation, every `ingest` procedure, every read-only chat query. The
  one router that did touch it re-resolved explicitly anyway. The context is now
  `{ ...rest, session, entitlements }` and nothing more, and the four procedures
  that spend, refund or report credits resolve where they read.
- **`rateLimit` is deleted.** It was applied to zero procedures. Three features
  re-exported it from their `api/trpc.ts` barrels and none called it. Chat meters
  credits inline in `send`, which the #109 amendment above already records. The
  middleware this ADR's original prose named as _the_ consume path had no
  consumers left.
- **`requireTier` moves to `@acme/billing`.** Its only call sites were billing's
  two example procedures. `feedback` and `ingest` have no tiers, so the shared
  substrate was shipping a tier gate to packages with nothing to gate. It is now
  built on billing's own `protectedProcedure`, resolves entitlements itself, and
  injects the result, so the procedure it admits reuses that resolution rather
  than paying for a second one. The span attributes `subscription.status` and
  `subscription.tier` moved with it.

### Why the seam stays

Not for the reason the opening gives. `@acme/subscriptions` today depends on
`@acme/entitlements`, `@acme/env`, `@acme/logger`, `@acme/redis` and zod, with no
Stripe SDK. Its `CREDIT_LIMITS` and `DEFAULT_LIMIT` both carry profile defaults,
so a clean checkout needs no rows for it. Two live reasons remain, neither of
them env:

1. **Behaviour.** A slim app with a real provider would meter credits for real.
   No Stripe subscription resolves to `{ status: 'none' }`, `getSubscriptionType`
   maps that to `Basic`, and `Basic` is 250 credits a month. A single-user local
   deployment would start refusing chat turns against a Stripe account that does
   not exist. Metered or unlimited is a per-deployment decision, and the provider
   is how a deployment makes it.
2. **Connection cost.** `@acme/redis`'s client opens three connections at module
   load. A direct import would hand `@acme/feedback` three Redis connections at
   boot for code it never calls.

### Selection is per deployment; resolution is per request

The "considered and rejected" entry above turned down build-time provider
injection on the grounds that billing is "app-swappable, not a feature-owned
constant". That conflates two things. _Which_ provider a deployment uses **is** a
constant per deployment. It is chosen once, at the app edge, exactly like `db`.
What that provider _returns_ is per request. The rejection was right, because the
provider still has to reach a per-request `ctx.entitlements` for procedures to
resolve against. The reason given for it was wrong.

Keeping the distinction straight is what makes this amendment coherent: the
provider is injected once per request because that is where the request is, and
resolution happens at the procedures that need it because that is where the read
is. Nothing in between needs to do either.

## Amendment (#256) — the context extension is the feature's to declare

The seam holds and the injection point still does not move: a provider reaches
procedures as `ctx.entitlements`, and a deployment still chooses between
`subscriptionsEntitlements` and `unlimitedEntitlements` at its edge. What changes
is **who declares that the context has that field**.

`@acme/trpc` used to. `entitlements: EntitlementsProvider` was a required field on
`createTRPCContext`'s options, so constructing _any_ context meant naming the
billing contract. That reached `@acme/feedback` and `@acme/ingest`, which have
neither a tier to gate on nor a credit to spend, and both slim apps. It also put
`SubscriptionTier`, `CreditBalance` and `isTierAtLeast` in `@acme/trpc/testing`,
which meant all 14 `createTestContext` call sites set a tier — including the ones
whose feature has no concept of one.

The #250 amendment above had already removed every _read_. What was left was
type-level residue. It was still enough to force the coupling on every consumer.

- **The context extension is a type parameter.** `createTRPCContext<TExtension>`,
  `createFeatureTRPC<TExtension>` and `createFeatureTRPCWithDb<TDb, TExtension>`
  take the feature's own per-request additions and merge them into every
  procedure's `ctx`. It defaults to `object` — no extension — which is the
  common case. `@acme/billing` declares `BillingContext` and `@acme/chat`
  declares `ChatContext`, both `{ entitlements: EntitlementsProvider }`;
  `@acme/feedback` and `@acme/ingest` declare nothing and name no billing type
  anywhere.
- **`@acme/entitlements` leaves `@acme/trpc`'s dependencies**, and no file under
  its `src/` imports it. That dependency edge is the one this change deleted by hand; this
  removes the reason it existed.
- **The mock provider moves to `@acme/entitlements/testing`**, beside the contract
  it implements — the only package that can name the tier vocabulary without
  acquiring a billing dependency, which is the same argument that puts
  `unlimitedEntitlements` there. `@acme/trpc/testing` keeps `createTestContext`
  and `createMockSession` and takes the same extension type parameter, so a test
  builds its context the way an app adapter builds a real one.
- **`createTestContext` takes `session` rather than a bare `user`.** Every key a
  test passes is now a key the real context has, so the extension merges straight
  through instead of the builder picking the principal back out. It also keeps the
  return type nameable as `BaseContext & TExtension`, which turns out to matter: an
  inferred `headers` resolves `Headers` against the _consuming_ package's lib, and
  they do not all agree. `@acme/auth` reads one whose iterators differ from
  `@acme/trpc`'s, and the context stops matching `createCaller`.

- **The apps inject per mount, not per app.** Each app's route seam exports two
  builders over one resolver each — `createTRPCRouteHandlers` (the base context)
  and `createTRPCRouteHandlersWithEntitlements` (base + provider), named
  `createTRPCServerHandlers*` in the TanStack apps. The chat and billing mounts
  use the second; `feedback`, `ingest` and `notifications` use the first and are
  handed no provider at all. One shared resolver used to inject `entitlements`
  into every context, which meant the field arrived at features that could not
  name it — passed through untyped, since the pass-through no longer rejects extra
  keys. Binding the resolver at the builder makes the wiring load-bearing in both
  directions: a mount whose feature declares an extension its builder does not
  produce is a compile error (verified: pointing chat's mount at the plain builder
  fails with TS2322).

Behaviour is unchanged for every mount that reads entitlements. The three that
never did stop receiving a provider they ignored.

### Two corrections to the spec this came from

The spec (#219) prescribed exposing the tier gate behind an
`@acme/entitlements/trpc` export. #250 landed it in `@acme/billing` instead, and
billing owning tiers is the better shape, so it stays there.

The spec also made this a prerequisite of the bank sync. It isn't — the runtime
coupling was already gone, and this stands on its own.

### What did not change, and why the slim apps still inject a provider

`apps/nextjs-slim` and `apps/tanstack-slim` still construct
`unlimitedEntitlements` and inject it. That is correct rather than residue. They
mount `@acme/chat`, which meters credits, so they are choosing _unmetered_, which
is exactly the per-deployment decision the original decision above exists to make
explicit.

What is narrower than it sounds: an app mounting only `feedback`, `ingest` and
`notifications` would now import no billing package at all, but nobody has written
that app, so "a no-billing app needs no billing types" is untested end to end.
What is demonstrated today is one step short of it — those three features name no
billing type, none of the four apps hands them a provider, and the compiler
enforces both halves.

### Why not a generic context, as the old comment said

`@acme/trpc` carried a note that a generic context parameter "makes tRPC's
middleware conditional types explode". That was true of what it described but not
of the parameter itself. With a generic context, tRPC's `ContextCallback`
conditionals stay unresolved, and the `MiddlewareBuilder` a standalone
`t.middleware(fn)` produces stops being assignable to what `.use` expects — the
two only agree once the context is concrete. Passed _inline_ to `.use`, the arrow
is contextually typed by `.use` itself and the two are never compared.

So the middlewares are now inline one-liners delegating to plain helpers
(`withProcedureSpan`, `withTimingLog`, `requirePrincipal`, `requireAdmin`). That
is the whole cost of the type parameter, and it reads better than what it
replaced. The span lifecycle and the auth gates are ordinary functions now, with
no tRPC types in them. The base half of the context stays concrete, so those gates
still narrow `ctx.session.user` against a real type rather than a type parameter.

One further cost worth recording, because it looks like a mistake: `src/index.ts`
imports a type from `@trpc/server/unstable-core-do-not-import`. Generic in the
extension, the builder type the two factories return is declared only in that
internal module, and declaration emit fails with TS2742 unless some import names
it by a path. The alternative is hand-annotating both factories with several
hundred characters of tRPC internals.

## Amendment (#264) — the type parameter is gone; the feature names its whole context

The seam is unchanged for a third time: a provider still reaches procedures as
`ctx.entitlements`, still chosen at the app edge, still required with no default.
What goes is the mechanism the amendment above introduced to carry it.

`TExtension` was never read. `@acme/trpc` merged it into `BaseContext` and named
none of its fields, so the parameter existed only to be threaded — and the
threading cost more than the thing threaded:

- `createTRPCContext` had become an identity function. The route seam already
  stacked two callbacks: the app's resolver built the object, then the feature's
  `createTRPCContext` returned it unchanged, typed `Promise<unknown>`. It carried
  a type and nothing else.
- `createFeatureTRPCWithDb` injected a singleton the feature already exported.
  `export const db` sat three lines above the call; tests imported that export
  directly and never swapped it, so `ctx.db` was not the seam it looked like, and
  `@acme/billing` called the factory without reading `ctx.db` once.
- The generic itself cost the inline-arrow rule and the
  `@trpc/server/unstable-core-do-not-import` import recorded just above — a
  subpath tRPC marks private, in the file #219 measures as this bank's
  most-diverged. `index.ts` had grown 296 → 359 lines paying for it.

So `@acme/trpc` exports the pieces instead — `trpcConfig`, plus
`withProcedureSpan` / `withTimingLog` / `requirePrincipal` / `requireAdmin` — and
each feature writes about twenty lines against its own concrete context:

```ts
export interface ChatContext extends BaseContext {
  entitlements: EntitlementsProvider;
}

const t = initTRPC.context<ChatContext>().create(trpcConfig);
```

`createTRPCContext`, `createFeatureTRPC` and `createFeatureTRPCWithDb` are
deleted, along with the five feature re-exports, the five `/server` barrel
re-exports and the app route threading. `t.middleware()` composes normally again,
the private subpath import is gone, and a feature's context is declared and
consumed in one file.

**The mount check survives, in a stronger form.** The previous amendment made the
wiring load-bearing by currying one resolver per builder and checking the
feature's `createTRPCContext` against it. With no `createTRPCContext` to check,
the check moves onto the thing that already knew the answer: `createTRPCFetchHandler`
infers the context from the `router` it is given and types `resolver` against it.
Each app now exports its resolvers and each mount names one. Verified the same
way: pointing chat's Next.js mount at the plain `resolveContext` fails with
TS2322 (`… is not assignable to type '(req: Request) => NoInfer<ChatContext> |
Promise<NoInfer<ChatContext>>'`).

**The counter-argument, recorded.** A factory cannot drift and hand-written wiring
can — and `handler.ts` records that the apps did drift before it existed. The
judgement here is that twenty generator-templated lines that typecheck are a
smaller risk surface than a private tRPC subpath plus an inline-arrow rule nothing
enforces. Everything that _can't_ typecheck its way out of drift — the fetch
handler, `logTRPCError`, the CORS policy — still lives in `@acme/trpc/handler`.
