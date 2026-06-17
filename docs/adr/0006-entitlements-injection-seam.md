# Billing is injected into the tRPC context as an `EntitlementsProvider`

The auth seam ([ADR 0003](0003-framework-agnostic-auth-seam.md)) made the
*current user* an injected value, but billing stayed hard-wired: `@acme/trpc`'s
`createTRPCContext` imported `@acme/subscriptions` directly (Redis + Stripe env)
to read the caller's subscription, tier, and credit balance. Because every
feature reuses the platform tRPC substrate, that single import pulled billing —
and its Stripe environment requirement — into *every* feature's dependency
graph. Dropping the `@acme/billing` *feature* was already trivial (just don't
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
   logic and now *implements* the contract via a `subscriptionsEntitlements`
   adapter. A no-billing build injects `unlimitedEntitlements` from
   `@acme/entitlements` (top tier, infinite credits, no-op `consume`). A missing
   provider is a type error, not a silent default.

## Status

accepted

## Considered and rejected

- **A build-time injected provider (like the `db` seam).** `@acme/trpc`'s
  `createFeatureTRPCWithDb(db)` injects the database once at feature-build time.
  Billing is different: it is an *app-swappable* policy (Stripe vs. unlimited),
  not a feature-owned constant, so it belongs on the per-request context next to
  `auth` — the same shape, the same injection point. Adding a second injection
  style for an app-swappable dependency would fork the one pattern the repo
  already has. Rejected.
- **An optional `entitlements` with an `unlimited` fallback.** Defaulting to
  unlimited when omitted would make a forgotten provider silently grant every
  caller Pro — the billing equivalent of a silent unauthenticated context.
  Rejected for the same reason the auth seam has no fallback: the deployment
  must *choose*.
- **A new `Unlimited` tier.** The no-billing provider returns the existing top
  tier (`Pro`) so `requireTier` admits every caller without a new enum member
  rippling through the tier ordering, the Stripe adapter, and billing's UI.
  Rejected — reuse `Pro`.
- **Keeping the Zod `SubscriptionCacheSchema` in `@acme/entitlements`.** The
  *type* `SubscriptionCache` is neutral and moves to the contract, but the Zod
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
