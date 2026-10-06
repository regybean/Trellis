# Subscriptions (`@acme/subscriptions`)

Server-only package. Single source of truth for reading a user's Subscription state and Credit balance from Redis. No Stripe API calls — that is `@acme/billing`'s job. This package only reads what `@acme/billing` has already synced.

It is the **Stripe/Redis-backed adapter** for the `@acme/entitlements` contract: it implements `EntitlementsProvider` as `subscriptionsEntitlements` and re-exports the relocated contract types (`SubscriptionTier`, `SubscriptionCache`). The neutral types live in `@acme/entitlements`; the tier ordering (`isTierAtLeast`) is imported from `@acme/entitlements` directly, not re-exported here. The Zod `SubscriptionCacheSchema` that validates the Stripe-shaped variant stays here, guarded by a conformance assertion against the contract type.

## Language

**Subscription cache**:
The Redis-persisted snapshot of a user's Stripe subscription state. Keyed at `stripe:user:{userId}` → `stripe:customer:{customerId}`. Contains status, product ID, price ID, billing period timestamps, and payment method info.
_Avoid_: "subscription record", "billing data"

**Subscription tier**:
A string enum derived from the Subscription cache: `Basic` | `Standard` | `Pro`. `Basic` is the default when no active subscription exists. Tiers are an **ordered hierarchy** — `Basic < Standard < Pro` — and a higher tier satisfies any lower-tier requirement (Pro can access Standard-gated features).
_Avoid_: "plan level", "account type"

**Credit balance**:
The remaining credits for a user in the current billing window. Stored in Redis at `credits:{userId}:{tier}` — a format owned solely by the `credits` policy module; callers invoke operations and never assemble the key themselves. `credits.read()` creates the key with the full credit limit (and the billing-window expiry, atomically) if it does not yet exist.
_Avoid_: "token count", "remaining tokens"

**Billing window**:
A `{ start, end }` pair of Unix timestamps. For active subscriptions: the Stripe period. For Basic: the current calendar month. Used to set the Redis key expiry so credits reset automatically.

## Relationships

- `getUserSubscriptionFromRedis(userId)` → returns **Subscription cache** (or a `status: 'none'` default)
- `getSubscriptionType(subscription)` → derives **Subscription tier** from the cache
- `credits.read(userId, subscription, tier)` → reads or eagerly initialises the **Credit balance** key
- `credits.consume(userId, tier, amount)` → decrements the balance (via `subscriptionsEntitlements.consume`, called inline by `chat.send`)
- `credits.refund(userId, tier, amount)` → increments the balance back (via `subscriptionsEntitlements.refund` — the adapter side of the `refund` seam; the chat control plane owns the idempotency guard)
- `credits.reset(userId)` / `credits.maxOut(userId)` → set the balance to the full limit / to zero, with the billing-window expiry in one atomic command
- `credits.overrideExpiry(userId, expiresAt)` → moves the **Billing window** expiry (creating the key if missing)
- `credits.status(userId)` → the admin balance view (balance + whether the key is materialised)

The `reset`/`maxOut`/`overrideExpiry`/`status` operations fetch the **Subscription cache** and derive the **Subscription tier** themselves, because their callers (the billing admin router) target an arbitrary user rather than the request's own context.

## Decisions

See [`docs/adr/`](../../../docs/adr/).
