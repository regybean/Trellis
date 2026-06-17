# Entitlements (`@acme/entitlements`)

Pure contract package — no Redis, no Stripe, no env, no IO. Defines the neutral
seam the platform tRPC substrate (`@acme/trpc`) uses for billing decisions
(rate limiting + tier gating), with zero knowledge of how those entitlements are
sourced. A full deployment injects the Stripe/Redis-backed adapter from
`@acme/subscriptions`; a no-billing deployment injects `unlimitedEntitlements`.
See [`docs/adr/0006-entitlements-injection-seam.md`](../../../docs/adr/0006-entitlements-injection-seam.md).

## Language

**Entitlement**:
What a caller is permitted (their resolved `tier` + `credits`) given their
`subscription`. The bundle the platform reads to decide whether a request is
admitted. The `Entitlements` value is `{ subscription, tier, credits }`.
_Avoid_: "permissions", "plan", "quota"

**Entitlements provider**:
The injected policy the platform calls instead of importing a billing
implementation: `resolve(userId)` → `Entitlements`, `consume(userId, tier,
amount)` decrements credits after a guarded request, `isTierAtLeast(tier,
minTier)` tests the tier ordering. Apps wire one concrete provider into
`createTRPCContext` per request.
_Avoid_: "billing service", "subscription client"

**Subscription tier**:
A string enum, ordered `Basic < Standard < Pro`. A higher tier satisfies any
lower-tier requirement. The type is relocated here from `@acme/subscriptions` so
the substrate can reference it without depending on the Stripe adapter.
_Avoid_: "plan level", "account type"

**Credit balance**:
A caller's remaining credits in the current billing window: `{ remaining,
limit, resetAt }`. The contract carries only the shape; the Stripe adapter owns
the Redis-backed materialisation.
_Avoid_: "token count", "remaining tokens"

**Subscription cache**:
The neutral subscription-state shape read by the substrate. The
`{ status: 'none' }` variant is the canonical "no billing" state — what
`unlimitedEntitlements` returns and what a deployment without Stripe always
sees. The type lives here; the Zod schema that validates the Stripe-shaped
active variant stays in `@acme/subscriptions` (its only producer), guarded by a
conformance assertion against this type.
_Avoid_: "subscription record", "billing data"

**Unlimited provider**:
`unlimitedEntitlements` — the no-billing implementation: every caller is the top
tier (`Pro`, so `requireTier` always admits) with effectively infinite credits
and a no-op `consume`. Pure; injected by deployments that drop
`@acme/subscriptions` (e.g. a single-user slim app).
_Avoid_: "free tier", "dev provider", a new `Unlimited` tier

## Relationships

- `EntitlementsProvider.resolve(userId)` → `Entitlements` (`{ subscription, tier, credits }`)
- `EntitlementsProvider.consume(userId, tier, amount)` → decrements the **Credit balance** (the rate-limit middleware in `@acme/trpc`)
- `EntitlementsProvider.isTierAtLeast(tier, minTier)` → tier-ordering test (the source of truth for `requireTier`)
- `unlimitedEntitlements` → the no-billing `EntitlementsProvider`
- `subscriptionsEntitlements` (in `@acme/subscriptions`) → the Stripe/Redis-backed `EntitlementsProvider`

## Design decisions

**Contract, not implementation**: This package is the dependency the platform
substrate is allowed to take. It must never import Redis, Stripe, or read env —
that keeps `@acme/trpc` (and therefore every feature) free of billing
infrastructure. The two providers live elsewhere: the Stripe adapter in
`@acme/subscriptions`, the unlimited one here (because it has no dependencies).

**Required injection, no default**: `createTRPCContext` requires an
`EntitlementsProvider`. There is deliberately no implicit `unlimited` fallback —
a forgotten provider would silently grant every caller Pro, the billing
equivalent of a silent unauthenticated context. The deployment must choose.

**Top tier, not a new tier**: `unlimitedEntitlements` returns the existing `Pro`
tier rather than introducing an `Unlimited` member, so `requireTier` admits
every caller without a new enum rippling through the ordering, the Stripe
adapter, and billing's UI.
