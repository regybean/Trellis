# Subscriptions (`@acme/subscriptions`)

Server-only package. Single source of truth for reading a user's Subscription state and Credit balance from Redis. No Stripe API calls — that is `@acme/billing`'s job. This package only reads what `@acme/billing` has already synced.

## Language

**Subscription cache**:
The Redis-persisted snapshot of a user's Stripe subscription state. Keyed at `stripe:user:{userId}` → `stripe:customer:{customerId}`. Contains status, product ID, price ID, billing period timestamps, and payment method info.
_Avoid_: "subscription record", "billing data"

**Subscription tier**:
A string enum derived from the Subscription cache: `Basic` | `Standard` | `Pro`. `Basic` is the default when no active subscription exists. Tiers are an **ordered hierarchy** — `Basic < Standard < Pro` — and a higher tier satisfies any lower-tier requirement (Pro can access Standard-gated features).
_Avoid_: "plan level", "account type"

**Credit balance**:
The remaining credits for a user in the current billing window. Stored in Redis at `credits:{userId}:{tier}`. Computed by `getCredits()` — creates the key with the full credit limit if it does not yet exist.
_Avoid_: "token count", "remaining tokens"

**Billing window**:
A `{ start, end }` pair of Unix timestamps. For active subscriptions: the Stripe period. For Basic: the current calendar month. Used to set the Redis key expiry so credits reset automatically.

## Relationships

- `getUserSubscriptionFromRedis(userId)` → returns **Subscription cache** (or a `status: 'none'` default)
- `getSubscriptionType(subscription)` → derives **Subscription tier** from the cache
- `getCredits(userId, subscription, tier)` → reads or initialises the **Credit balance** key in Redis
- `getCreditLimit(tier)` → returns the Credit limit for a given tier
- `isTierAtLeast(tier, minTier)` → tests the tier ordering (`Basic < Standard < Pro`); the source of truth for tier-gating in `@acme/trpc`'s `requireTier`
- `getBillingWindow(subscription)` → returns the window timestamps used to set key expiry

## Design decisions

**Read-only by design**: This package never writes Stripe data to Redis — that is done by the Stripe webhook handler in `@acme/billing`. Separation ensures the read path is fast and the write path is controlled.

**Eager credit initialisation**: If `credits:{userId}:{tier}` does not exist when `getCredits()` is called, it is created immediately with the full limit and set to expire at the end of the billing window. This avoids a separate "provision credits" step on first use.
