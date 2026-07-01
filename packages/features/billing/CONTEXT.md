# Billing (`@acme/billing`)

Stripe-backed subscription management and credit-based rate limiting. Owns the checkout flow, billing portal, subscription tier enforcement, and admin tools for managing user credit balances.

## Language

**Subscription**:
A user's current Stripe subscription state. One of three tiers: Basic (free, no Stripe subscription), Standard, or Pro. Cached in Redis via `@acme/subscriptions`.
_Avoid_: "plan", "license", "account type"

**Tier**:
The named level of a Subscription — `Basic` | `Standard` | `Pro`. An ordered hierarchy (`Basic < Standard < Pro`): a higher tier satisfies any lower-tier gate. Determines the Credit limit and which procedures are accessible.
_Avoid_: "level", "rank", "grade"

**Credit**:
A consumable unit that gates LLM requests. Each user has a credit balance per billing window. Consumed by the `rateLimit()` middleware. Replenishes at the start of each billing window.
_Avoid_: "token" (clashes with LLM vocabulary), "point", "quota unit"

**Credit limit**:
The total credits allocated per billing window for a given Tier (Basic: 250, Standard: 350, Pro: 1600). Set in `@acme/subscriptions`.
_Avoid_: "budget", "allowance"

**Billing window**:
The period over which credits are counted — aligned to the Stripe subscription period for paid tiers, or calendar month for Basic. Credits reset at the end of each window.
_Avoid_: "cycle", "period", "month"

**Checkout session**:
A Stripe-hosted payment page created for a user to upgrade their Subscription. Created via `account.createCheckoutSession`.
_Avoid_: "payment page", "upgrade link"

**Billing portal**:
The Stripe-hosted page where a user manages their Subscription (cancel, update payment method). Accessed via `account.createDashboardSession`.
_Avoid_: "dashboard", "account page"

## Relationships

- A **Subscription** is associated with a Stripe customer (looked up via `stripe:user:{userId}` Redis key)
- **Tier** is derived from the Subscription's Stripe product ID
- **Credit** balance is stored in Redis at `credits:{userId}:{tier}`, expiring at the end of the **Billing window**
- Tier access is enforced by `requireTier(minTier)` (from `@acme/trpc`), composed onto `protectedProcedure` per procedure. `requireTier('Standard')` admits Standard or Pro (i.e. any paying customer); `requireTier('Pro')` admits Pro only
- Admin procedures (`resetUserRateLimit`, `maxOutUserRateLimit`, `overrideUserRateLimitExpiry`) directly manipulate the Redis credit key
- `setUserTier` (admin, localstripe dev only) cancels/creates a Stripe subscription directly to move a user between Tiers without Checkout

## Design decisions

**Business logic lives in `src/hooks/`, components are UI-only** (slice contract, CLAUDE.md): components no longer call `useTRPC()` directly. The tRPC data access + flows are deep modules behind small hooks — `usePricing` (Subscription read + plan selection → Checkout/Billing-portal routing), `useCheckout` (Checkout/portal sessions + redirect), `useSubscriptionDetails`, `useRateLimitAdmin`, `useTierAdmin`, `useStripeTesting`, `useBillingSync`. The plan-selection decision tree (the Tier hierarchy `Basic < Standard < Pro`) is pure and unit-tested in `src/lib/plan-selection.ts` (`getButtonState`); `src/data/pricing-data.ts` holds pure data (plans, colours, examples) only. Hooks navigate via `globalThis.location` (runtime-agnostic), not `next/navigation` — the one remaining `next/navigation` use is in `StripeSuccessRedirect`, the app-facing seam.

**Credits are not Stripe metered billing**: The credit system is a Redis token bucket, not a Stripe usage record. Credits reset on a per-billing-window schedule but are not billed per-credit.

**Local dev runs on localstripe, not real Stripe**: When `STRIPE_API_BASE` is set, `getStripe()` retargets the SDK at a fake stateful Stripe server (the default dev config). localstripe predates the Prices API, so it serves the legacy `plan` shape — `buildSubscriptionCache` reads `price ?? plan` and `syncStripeDataToKV` skips the unsupported expands. Tiers are granted from the admin page (`setUserTier`) rather than Checkout. See [`docs/adr/0003-localstripe-dev-billing.md`](../../../docs/adr/0003-localstripe-dev-billing.md).

**Tier-gating is hierarchical and decision-only**: Gates compare against a _minimum_ tier (`requireTier`), so higher tiers inherit lower-tier access. The gate reads the already-assembled Billing context and performs no Redis or Stripe I/O. The previous dev-only inline Stripe re-sync was removed from the gate: it ran _after_ the subscription was read into context, so it never affected the current request's decision (only the next one) while paying a Stripe round-trip on every gated request. Keeping the local `stripe:customer:*` cache fresh in dev is a separate concern (Stripe webhooks / manual sync), not the gate's job.
