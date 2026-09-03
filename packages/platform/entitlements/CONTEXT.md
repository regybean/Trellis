# Entitlements (`@acme/entitlements`)

Pure contract package — no Redis, no Stripe, no env, no IO. Defines the neutral
seam a feature that meters or gates on billing (`@acme/billing`, `@acme/chat`)
names in its tRPC context extension, with zero knowledge of how those
entitlements are sourced. A full deployment injects the Stripe/Redis-backed
adapter from `@acme/subscriptions`; a no-billing deployment injects
`unlimitedEntitlements`. The tRPC substrate itself no longer names this contract
at all (#256).
See [`docs/adr/0006-entitlements-injection-seam.md`](../../../docs/adr/0006-entitlements-injection-seam.md).

## Language

**Entitlement**:
What a caller is permitted (their resolved `tier` + `credits`) given their
`subscription`. The bundle the platform reads to decide whether a request is
admitted. The `Entitlements` value is `{ subscription, tier, credits }`.
_Avoid_: "permissions", "plan", "quota"

**Entitlements provider**:
The injected policy the platform (and any request-less executor, e.g. the chat
Generation worker) calls instead of importing a billing implementation:
`resolve(userId)` → `Entitlements`, `consume(userId, tier, amount)` decrements
credits after a guarded request, `refund(userId, tier, amount)` credits them back
(the inverse of `consume`, for a charged request that did not deliver its value),
`isTierAtLeast(tier, minTier)` tests the tier ordering. `consume` and `refund`
are symmetric — a Credit crosses this one seam in both directions, so a billing
swap changes a single adapter. Any per-caller idempotency guard on a refund is
the caller's concern, not the provider's. Apps wire one concrete provider into
`createTRPCContext` per request (and into their worker entrypoint).
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
tier (`Pro`, so billing's tier gate always admits) with effectively infinite credits
and a no-op `consume` **and** a no-op `refund` (a deployment that charged nothing
refunds nothing). Pure; injected by deployments that drop `@acme/subscriptions`
(e.g. a single-user slim app) — both into `createTRPCContext` and into the app's
worker entrypoint.
_Avoid_: "free tier", "dev provider", a new `Unlimited` tier

## Relationships

- `EntitlementsProvider.resolve(userId)` → `Entitlements` (`{ subscription, tier, credits }`), called by the procedures that read it, never by `@acme/trpc` (#250)
- `EntitlementsProvider.consume(userId, tier, amount)` → decrements the **Credit balance** (called inline by `chat.send` after a guarded request)
- `EntitlementsProvider.refund(userId, tier, amount)` → increments the **Credit balance** back (called by the chat Generation worker on `error` and by `chat.reconcileTurn` on orphan; the chat control plane owns the idempotency guard)
- `EntitlementsProvider.isTierAtLeast(tier, minTier)` → tier-ordering test, part of the contract every provider implements
- `unlimitedEntitlements` → the no-billing `EntitlementsProvider`
- `subscriptionsEntitlements` (in `@acme/subscriptions`) → the Stripe/Redis-backed `EntitlementsProvider`
- `createMockEntitlements({ tier, credits })` (`@acme/entitlements/testing`) → the test `EntitlementsProvider`: `resolve` echoes the knobs with a tier-faithful subscription, `consume`/`refund` no-op, `isTierAtLeast` is the real ordering

## Design decisions

**Contract, not implementation**: This package is the dependency the platform
substrate is allowed to take. It must never import Redis, Stripe, or read env —
that keeps `@acme/trpc` (and therefore every feature) free of billing
infrastructure. The two providers live elsewhere: the Stripe adapter in
`@acme/subscriptions`, the unlimited one here (because it has no dependencies).

**Required injection, no default**: a feature whose context extension names an
`EntitlementsProvider` requires one. There is deliberately no implicit `unlimited`
fallback — a forgotten provider would silently grant every caller Pro, the billing
equivalent of a silent unauthenticated context. The deployment must choose.

**Top tier, not a new tier**: `unlimitedEntitlements` returns the existing `Pro`
tier rather than introducing an `Unlimited` member, so billing's tier gate admits
every caller without a new enum rippling through the ordering, the Stripe
adapter, and billing's UI.

**The substrate doesn't call `resolve` — or name this contract at all** (#250,
#256): `@acme/trpc` first stopped invoking the provider, then stopped typing a
context field with it. `ctx.entitlements` is now billing's and chat's own context
extension; `@acme/trpc` doesn't depend on this package. The gate that used to live
there (`requireTier`) is `@acme/billing`'s, built on the same contract — which is
the point of the contract being a package rather than a platform export.

**The test double ships beside the contract** (`./testing`, #256): the mock
`EntitlementsProvider` used to live in `@acme/trpc/testing`, which meant every
feature's test context imported a tier and a credit balance to build a caller —
including the two with neither. It belongs here for the same reason
`unlimitedEntitlements` does: this is the only package that can name
`SubscriptionTier` and `CreditBalance` without acquiring a billing dependency.
