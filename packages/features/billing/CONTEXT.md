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
A consumable unit that gates LLM requests. Each user has a credit balance per billing window. Consumed inline by the procedure that spends it (`chat.send`), through `ctx.entitlements.consume`. Replenishes at the start of each billing window.
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
- Tier access is enforced by `requireTier(minTier)`, this slice's own procedure builder (`src/api/trpc.ts`) on top of its `protectedProcedure`. `requireTier('Standard')` admits Standard or Pro (i.e. any paying customer); `requireTier('Pro')` admits Pro only
- Admin procedures (`resetUserRateLimit`, `maxOutUserRateLimit`, `overrideUserRateLimitExpiry`) directly manipulate the Redis credit key
- `setUserTier` (admin, localstripe dev only) cancels/creates a Stripe subscription directly to move a user between Tiers without Checkout

## Design decisions

**Business logic lives in `src/hooks/`, components are UI-only** (slice contract, CLAUDE.md): components no longer call `useTRPC()` directly. The tRPC data access + flows are deep modules behind small hooks — `usePricing` (Subscription read + plan selection → Checkout/Billing-portal routing), `useCheckout` (Checkout/portal sessions + redirect), `useSubscriptionDetails`, `useRateLimitAdmin`, `useTierAdmin`, `useStripeTesting`, `useBillingSync`. `useSubscriptionDetails` (the two-query read behind `NavUserSubscription`) and `useBillingSync` (the post-checkout cache invalidation behind `StripeSuccessRedirect`) are thin, but they are **justified** rather than folded: the slice contract — enforced by lint (`no-restricted-imports` bans `**/trpc/react` from `src/components/**`) — requires all feature data access to live in `src/hooks/`, so these are the mandated tRPC seam that keeps their sole-consumer components UI-only, not removable wrappers. The plan-selection decision tree (the Tier hierarchy `Basic < Standard < Pro`) is pure and unit-tested in `src/lib/plan-selection.ts` (`getButtonState`); `src/data/pricing-data.ts` holds pure data (plans, colours, examples) only. Hooks navigate via `globalThis.location` (runtime-agnostic), not `next/navigation` — the one remaining `next/navigation` use is in `StripeSuccessRedirect`, the app-facing seam.

**Billing redirect module** (`src/hooks/use-billing-redirect.ts`, `useBillingRedirect`): the single home for the create-session → redirect-URL → navigate flow. It owns both create-session mutations (Checkout session + Billing portal), the loading toast, the typed billing-error → toast mapping (over the `BillingErrorCode` seam), and the one navigation mechanism (`globalThis.location.href`). `useCheckout`, `useStripeTesting`, and `usePricing` all compose it rather than re-declaring the flow — `usePricing` layers only its own routing (signed-out → `/sign-in`, the localstripe-CTA gate, per-plan `isProcessing`) on top, so all three redirect call sites share one home.

**No `staleTime`, no persister, and no client of its own**: billing mounts through the shared `createFeatureClient` and its queries run on the app's single `QueryClient` ([ADR 0036](../../../docs/adr/0036-one-app-owned-query-client.md)).

Deleting the 30s `staleTime` reads like a decision but is closer to a correction. Billing's hooks call `useQuery` with no explicit client — it was the one feature that never pinned one (only chat, feedback and ingest got that mitigation). In both full apps the innermost `QueryClientProvider` below billing's own was **notifications**', which set no `defaultOptions.queries` at all. So every billing query already ran on the notifications cache at `staleTime: 0`, and the 30s billing declared had not been in effect for as long as the notifications provider has been mounted beneath it. Nothing broke: the queries and their invalidations resolved to the same client, so they agreed with each other. But the config was fiction, and no test caught it — the frontend suites mount billing's provider alone, where `useQueryClient()` does return billing's client.

`0` is also the value to keep on the merits. The reads are cheap Redis hits, every write path already invalidates explicitly (`useBillingSync`, the app's `onTokensConsumed`), and a 30s window could only ever hide a change the user just caused — credits after a Turn, tier right after a checkout return — which are exactly the moments the number has to be right. And credits/subscription are the queries ADR 0025 names as the ones never to persist: a restored snapshot of a balance the user is watching change is worse than a spinner.

**Credits are not Stripe metered billing**: The credit system is a Redis token bucket, not a Stripe usage record. Credits reset on a per-billing-window schedule but are not billed per-credit.

**Local dev runs on localstripe, not real Stripe**: In `localstripe` mode `getStripe()` retargets the SDK at a fake stateful Stripe server (the development profile's `STRIPE_CONNECTION`). That connection is projected once into the **localstripe mode** boolean (`stripe.mode === 'localstripe'`), the single value the rest of the slice reads. localstripe predates the Prices API, so it serves the legacy `plan` shape — `buildSubscriptionCache` reads `price ?? plan` (a shape-tolerant fallback, not mode-gated) and `syncStripeDataToKV` skips the unsupported expands in localstripe mode. The `setUserTier` dev grant is guarded on the same mode. Tiers are granted from the admin page (`setUserTier`) rather than Checkout, and the pricing CTA reads the provider-threaded mode to disable Checkout there. See [`docs/adr/0001-localstripe-dev-billing.md`](docs/adr/0001-localstripe-dev-billing.md).

**`ctx.entitlements` is billing's own context field** (#256, #264): the provider
was a required field on every tRPC context until the substrate stopped reading it,
at which point the field was buying nothing but a billing import in every feature
and both slim apps. Billing declares `BillingContext extends BaseContext` and
builds its tRPC instance on it directly — the slice whose whole job is billing is
the one that should have to name it. The app still chooses which provider at its
edge; the injection point did not move (ADR 0006 amendments).

**Tier-gating is hierarchical, and it lives here** (#250): Gates compare against a _minimum_ tier (`requireTier`), so higher tiers inherit lower-tier access. The gate used to be `@acme/trpc`'s, which meant `@acme/feedback` and `@acme/ingest` — neither of which has a tier — shipped a tier gate. Its only call sites were this slice's, so it moved to this slice. It resolves entitlements itself (one `ctx.entitlements.resolve`, no Stripe I/O) and injects the result, so the procedure it admits reads the same resolution the gate decided on. The previous dev-only inline Stripe re-sync was removed from the gate: it ran _after_ the subscription was read, so it never affected the current request's decision (only the next one) while paying a Stripe round-trip on every gated request. Keeping the local `stripe:customer:*` cache fresh in dev is a separate concern (Stripe webhooks / manual sync), not the gate's job.
