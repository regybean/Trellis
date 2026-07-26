# Billing is injected into the tRPC context as an `EntitlementsProvider`

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

## Status

accepted

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
  `ctx.user` is typed via an augmentable `InjectedUser` global (declaration
  merging) rather than a backend Clerk `User` import, so the substrate no longer
  names Clerk at all.
- **`createTRPCContext`'s signature gains a required `entitlements`.** Every
  caller supplies one: both apps' route handlers and the TanStack `clerk-context`
  resolver inject `subscriptionsEntitlements`; the reference RSC callers in chat
  and ingest take it as a parameter; a no-billing app injects
  `unlimitedEntitlements`.
- **chat and ingest depend on no billing or Clerk SDK.** Their `trpc/server.tsx`
  RSC callers became neutral factories (`createServerTRPC({ headers, auth, user,
entitlements })`); `@clerk/nextjs` and `@acme/subscriptions` left their
  `package.json`. `@acme/billing` remains legitimately coupled to Clerk + Stripe
  (its account router reads `ctx.user.primaryEmailAddress`; its success handler
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
