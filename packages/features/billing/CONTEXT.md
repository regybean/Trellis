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
A consumable unit that gates LLM requests. A Redis token bucket, not a Stripe usage record — credits are counted per Billing window and never billed per-credit. Each user has a credit balance per window, consumed inline by the procedure that spends it (`chat.send`) through `ctx.entitlements.consume`, and replenished at the start of the next window.
_Avoid_: "token" (clashes with LLM vocabulary), "point", "quota unit", "metered usage"

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
The single signal for "are we talking to localstripe rather than real Stripe?" — `localstripeMode`, derived once on the server from the `STRIPE_CONNECTION` union in `src/env.ts` and threaded to the browser through `BillingConfigProvider`. `true` when the SDK is pointed at the fake stateful Stripe server, which serves the legacy `plan` shape and has no Checkout or Billing-portal API.
_Avoid_: "dev mode", proxying the condition through `NODE_ENV`

## Relationships

- A **Subscription** is associated with a Stripe customer (looked up via `stripe:user:{userId}` Redis key)
- **Tier** is derived from the Subscription's Stripe product ID
- **Credit** balance is stored in Redis at `credits:{userId}:{tier}`, expiring at the end of the **Billing window**
- Tier access is enforced by `requireTier(minTier)`, this slice's own procedure builder (`src/api/trpc.ts`) on top of its `protectedProcedure`. `requireTier('Standard')` admits Standard or Pro (i.e. any paying customer); `requireTier('Pro')` admits Pro only
- Admin procedures (`resetUserRateLimit`, `maxOutUserRateLimit`, `overrideUserRateLimitExpiry`) directly manipulate the Redis credit key
- `setUserTier` (admin, localstripe mode only) cancels/creates a Stripe subscription directly to move a user between Tiers without Checkout
- **localstripe mode** gates the pricing CTA on the client and the skipped Stripe expands on the server

## Decisions

See [`docs/adr/`](docs/adr/).
