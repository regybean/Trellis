# Platform Redis (`@acme/redis`)

The shared node-redis clients, partitioned per app. It owns _how_ keys are
isolated across apps sharing one Redis instance — not _what_ any feature stores.

## Language

**Namespace**:
The per-app key prefix, sourced from `NEXT_PUBLIC_WEBAPP` via `@acme/redis/env`.
Mirrors the per-app Postgres schema: one app-identity value partitions every
shared datastore (ADR 0008). Empty in tests, which yields raw keys.
_Avoid_: "the prefix env", "the app name"

**Namespaced key** (`NamespacedKey`):
A Redis key or pub/sub channel that has already had the **Namespace** applied. A
branded type: the only way to make one is `nsKey`, and every key-bearing client
method accepts only this — so a raw, unprefixed string is a compile error.
_Avoid_: "the prefixed key", "the full key"

**`nsKey(...parts)`**:
The single key constructor. Colon-joins its parts and applies the **Namespace**
(or returns the bare key when the namespace is empty). The one place the prefix
is applied, so it cannot be forgotten.

**Key builder**:
A domain-specific function that composes a **Namespaced key** via `nsKey` —
`creditKey`, `stripeUserKey` / `stripeCustomerKey` (all private to
`@acme/subscriptions`). The stripe key shape is a storage detail hidden behind
`getStripeCustomerId` / `setStripeCustomerId` / `setSubscriptionCache`, so call
sites never build these keys themselves.

## Relationships

- `redis` / `redisPub` / `redisSub` are thin facades over the raw node-redis
  clients; their key/channel methods accept only a **Namespaced key**.
- A **Key builder** lives in the domain package that owns the data
  (`@acme/subscriptions` for credits + Stripe cache), not in `@acme/redis` —
  `@acme/redis` owns only `nsKey` and the clients.
- The **Namespace** value is the same `NEXT_PUBLIC_WEBAPP` that names the Postgres
  schema in `@acme/rag`; the two are surfaced through separate envs so tests can
  mock them independently (ADR 0008).

## Design decisions

**Prefixing is type-enforced, not allow-listed**: the prefix lives in `nsKey` and
the client demands a `NamespacedKey`, so a forgotten prefix won't compile. This
replaced an earlier `Proxy` that rewrote known commands from a hand-maintained
allow-list — which silently leaked unprefixed keys for any unlisted command (the
`expireAt` bug). See the amendment to ADR 0008.

**The facade does no runtime work**: `nsKey` already applied the prefix, so the
client wrapper only narrows the key parameter's type and delegates. The exposed
surface is the small set of commands actually in use plus infra pass-throughs.

**One sanctioned cast**: branding is nominal typing and needs a single
`as NamespacedKey` inside `nsKey`, isolated to that one constructor.
