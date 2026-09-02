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

**localstripe mode**:
The single signal for "are we talking to localstripe rather than real Stripe?". Derived once on the server as `stripe.mode === 'localstripe'` from `STRIPE_CONNECTION`, the server-side discriminated union in `src/env.ts` (ADR 0033; formerly the `STRIPE_API_BASE` env carve-out) — `true` when the SDK is pointed at the fake stateful Stripe server, which serves the legacy `plan` shape and has no Checkout/Billing-portal API. Read directly by the server branches that need a boolean, and threaded to the client through `BillingConfigProvider` so client code (pricing CTA) reads one value. _Avoid_: proxying it through `NODE_ENV` (a real-Stripe dev build would misclassify), "dev mode".

## Relationships

- A **Subscription** is associated with a Stripe customer (looked up via `stripe:user:{userId}` Redis key)
- **Tier** is derived from the Subscription's Stripe product ID
- **Credit** balance is stored in Redis at `credits:{userId}:{tier}`, expiring at the end of the **Billing window**
- Tier access is enforced by `requireTier(minTier)` (from `@acme/trpc`), composed onto `protectedProcedure` per procedure. `requireTier('Standard')` admits Standard or Pro (i.e. any paying customer); `requireTier('Pro')` admits Pro only
- Admin procedures (`resetUserRateLimit`, `maxOutUserRateLimit`, `overrideUserRateLimitExpiry`) directly manipulate the Redis credit key
- `setUserTier` (admin, localstripe dev only) cancels/creates a Stripe subscription directly to move a user between Tiers without Checkout

## Design decisions

**Business logic lives in `src/hooks/`, components are UI-only** (slice contract, CLAUDE.md): components no longer call `useTRPC()` directly. The tRPC data access + flows are deep modules behind small hooks — `usePricing` (Subscription read + plan selection → Checkout/Billing-portal routing), `useCheckout` (Checkout/portal sessions + redirect), `useSubscriptionDetails`, `useRateLimitAdmin`, `useTierAdmin`, `useStripeTesting`, `useBillingSync`. `useSubscriptionDetails` (the two-query read behind `NavUserSubscription`) and `useBillingSync` (the post-checkout cache invalidation behind `StripeSuccessRedirect`) are thin, but they are **justified** rather than folded: the slice contract — enforced by lint (`no-restricted-imports` bans `**/trpc/react` from `src/components/**`) — requires all feature data access to live in `src/hooks/`, so these are the mandated tRPC seam that keeps their sole-consumer components UI-only, not removable wrappers. The plan-selection decision tree (the Tier hierarchy `Basic < Standard < Pro`) is pure and unit-tested in `src/lib/plan-selection.ts` (`getButtonState`); `src/data/pricing-data.ts` holds pure data (plans, colours, examples) only. Hooks navigate via `globalThis.location` (runtime-agnostic), not `next/navigation` — the one remaining `next/navigation` use is in `StripeSuccessRedirect`, the app-facing seam.

**Billing redirect module** (`src/hooks/use-billing-redirect.ts`, `useBillingRedirect`): the single home for the create-session → redirect-URL → navigate flow. It owns both create-session mutations (Checkout session + Billing portal), the loading toast, the typed billing-error → toast mapping (over the `BillingErrorCode` seam), and the one navigation mechanism (`globalThis.location.href`). `useCheckout`, `useStripeTesting`, and `usePricing` all compose it rather than re-declaring the flow — `usePricing` layers only its own routing (signed-out → `/sign-in`, the localstripe-CTA gate, per-plan `isProcessing`) on top, so all three redirect call sites share one home.

**No `staleTime`, no persister, and no client of its own**: billing mounts through the shared `createFeatureClient` and its queries run on the app's single `QueryClient` ([ADR 0036](../../../docs/adr/0036-one-app-owned-query-client.md)). Both former defaults were examined rather than carried over. The 30s `staleTime` was create-t3-app boilerplate paired with an SSR setup billing never used; dropping it to react-query's `0` costs a cheap Redis read per mount and removes a window that could only ever hide a change the user just caused — credits after a Turn, tier right after a checkout return — which are exactly the moments the number has to be right. Every write path already invalidates explicitly (`useBillingSync`, the app's `onTokensConsumed`). And credits/subscription are the queries ADR 0025 names as the ones never to persist: a restored snapshot of a balance the user is watching change is worse than a spinner.

**Credits are not Stripe metered billing**: The credit system is a Redis token bucket, not a Stripe usage record. Credits reset on a per-billing-window schedule but are not billed per-credit.

**Local dev runs on localstripe, not real Stripe**: In `localstripe` mode `getStripe()` retargets the SDK at a fake stateful Stripe server (the development profile's `STRIPE_CONNECTION`). That connection is projected once into the **localstripe mode** boolean (`stripe.mode === 'localstripe'`), the single value the rest of the slice reads. localstripe predates the Prices API, so it serves the legacy `plan` shape — `buildSubscriptionCache` reads `price ?? plan` (a shape-tolerant fallback, not mode-gated) and `syncStripeDataToKV` skips the unsupported expands in localstripe mode. The `setUserTier` dev grant is guarded on the same mode. Tiers are granted from the admin page (`setUserTier`) rather than Checkout, and the pricing CTA reads the provider-threaded mode to disable Checkout there. See [`docs/adr/0003-localstripe-dev-billing.md`](../../../docs/adr/0003-localstripe-dev-billing.md).

**Tier-gating is hierarchical and decision-only**: Gates compare against a _minimum_ tier (`requireTier`), so higher tiers inherit lower-tier access. The gate reads the already-assembled Billing context and performs no Redis or Stripe I/O. The previous dev-only inline Stripe re-sync was removed from the gate: it ran _after_ the subscription was read into context, so it never affected the current request's decision (only the next one) while paying a Stripe round-trip on every gated request. Keeping the local `stripe:customer:*` cache fresh in dev is a separate concern (Stripe webhooks / manual sync), not the gate's job.
