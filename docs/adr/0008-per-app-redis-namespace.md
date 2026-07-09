# Each app gets its own Redis key namespace, prefixed from `NEXT_PUBLIC_WEBAPP`

The two apps (`nextjs`, `tanstack-start`) share one Redis instance the same way
they share one Postgres instance. Postgres isolation already exists and is
invisible: each app writes to a per-app schema created with
`pgSchema(process.env.NEXT_PUBLIC_WEBAPP)`, and the pgvector store mirrors it via
Mastra's `schemaName`. Redis had no equivalent — every credit balance
(`credits:<user>:<tier>`) and Stripe cache entry (`stripe:user:<id>`,
`stripe:customer:<id>`) landed in one flat keyspace. Two apps pointed at the same
Redis would read and clobber each other's keys, and there was no documented
construct naming the shared "one app-identity value partitions every shared
datastore" pattern that Postgres already relied on.

The fix mirrors the database construct rather than inventing a new axis of
isolation: **`NEXT_PUBLIC_WEBAPP` is the single app-identity value, and it now
drives the Redis key namespace too.**

Three decisions are load-bearing:

1. **The namespace is sourced from `NEXT_PUBLIC_WEBAPP`, surfaced through
   `@acme/redis/env`.** `env.ts` gains a required `NEXT_PUBLIC_WEBAPP`
   (`z.string().nonempty()`, in the `shared` block, wired through `runtimeEnv`),
   copied verbatim from `@acme/rag`'s env — the package that already reads the
   same value for `RAG_SCHEMA`. Production fails loud if it's missing, exactly
   like the Postgres schema.

2. **Prefixing is invisible to call sites — a `Proxy` wraps each client.**
   node-redis has no `keyPrefix` option (that is an ioredis feature), so
   `@acme/redis` wraps `redis`, `redisPub`, and `redisSub` in a `Proxy` that
   rewrites the first argument of an allow-listed set of key commands (`get`,
   `set`, `decrBy`, `incrBy`, `del`, `ttl`, `expire`, `exists`) and channel
   commands (`publish`, `subscribe`, `pSubscribe`, `unsubscribe`,
   `pUnsubscribe`). Every other member (`flushDb`, `duplicate`, `connect`, `on`,
   `multi`, `ping`, …) passes through untouched. Call sites keep their literal
   keys (`creditKey()` still returns `credits:<user>:<tier>`); the prefix is
   applied at the boundary. Keys become `nextjs:credits:…` /
   `tanstack-start:stripe:user:…`.

3. **An empty namespace yields raw keys with no leading colon, and that is the
   test path.** The prefix rule is `namespace ? \`${namespace}:${key}\` : key`.
Tests mock `@acme/redis/env`*without* a`NEXT_PUBLIC_WEBAPP`field, so the
namespace is absent and keys stay raw. This is deliberate: tests are
app-agnostic and must pass regardless of prefix, and a no-prefix test keyspace
keeps the test harness's own isolation (per-package logical DB`/N`+`flushDb`) independent of the app-identity mock.

## Status

accepted

## Considered and rejected

- **A separate Redis instance (or logical DB) per app.** Heavier than the
  problem: it forks connection config, doubles local/infra surface, and breaks
  from the Postgres construct (which shares one instance and partitions by
  namespace, not by server). A key prefix is the minimal mirror. Rejected.
- **An explicit `key()` / `namespacedKey()` helper at every call site.** Correct
  but leaky: every present and future Redis caller would have to remember to wrap
  its key, and a single missed call site silently writes an unprefixed,
  cross-app-colliding key. The `Proxy` makes correct-by-default the only option.
  Rejected.
- **Sourcing the namespace from the Postgres-schema value directly.** The two
  _happen_ to share `NEXT_PUBLIC_WEBAPP`, but coupling the Redis prefix to the
  rag/db schema constant would make tests that mock the Postgres schema (e.g.
  `feedback_test`) leak that value into the Redis keyspace. Surfacing the
  namespace through `@acme/redis/env` lets the two be mocked independently.
  Rejected.
- **An optional namespace with a silent default.** Defaulting to no prefix in
  production would let a forgotten env var silently collapse both apps back into
  one keyspace — the failure this ADR exists to prevent. Required and fail-loud,
  like the Postgres schema. Rejected.

## Consequences

- **No call site changes.** `creditKey()`, the `stripe:*` cache writes in
  `@acme/billing`, and `@acme/subscriptions`' reads all keep literal keys; the
  prefix is applied by the wrapper. The production command surface is small
  (`get`, `set`, `decrBy`, `ttl`) and fully covered by the allow-list.
- **New commands need an allow-list entry.** A guardrail comment marks the set:
  introducing a new key- or channel-bearing Redis command anywhere means adding
  it to the matching set in `client.ts`, or its keys leak unprefixed. A unit test
  asserts the prefixing per listed command and the empty-namespace branch.
- **`@acme/redis` gains a test harness.** The package flips from `testStatus:
todo` to a real backend-library suite (`vitest.config.backend.ts` +
  `src/tests/namespace.test.ts`), pulling in `@acme/vitest-config` and `vitest`.
- **This ADR retroactively names the shared construct.** The Postgres per-app
  schema was never recorded in an ADR; "one app-identity value
  (`NEXT_PUBLIC_WEBAPP`) partitions every shared datastore" is now documented
  here, and a third shared datastore should follow the same pattern.

## Amendment — the identity value: canonical names, fail-loud, and the root `.env` footgun

The construct above is only sound if every app actually resolves a _distinct_
`NEXT_PUBLIC_WEBAPP`. Two operational facts make that fragile, so they are
recorded here.

**Canonical identities (one per app, Postgres-identifier-safe):**

| App                   | `NEXT_PUBLIC_WEBAPP` |
| --------------------- | -------------------- |
| `apps/nextjs`         | `nextjs`             |
| `apps/nextjs-slim`    | `nextjs_slim`        |
| `apps/tanstack-start` | `tanstack_start`     |
| `apps/tanstack-slim`  | `tanstack_slim`      |

The value names a Postgres schema and a Redis prefix, so it must be a valid
unquoted Postgres identifier — **underscores, never hyphens** (`tanstack-start`
would need quoting and breaks `pgSchema()` / `schemaFilter`). The slim apps
(`*_slim`) carry no Redis or billing, but they _do_ take a per-app
Postgres/pgvector schema, so they need a distinct identity too.

**The footgun: `NEXT_PUBLIC_WEBAPP` must NEVER be set in the root `.env`.** Each
app loads env via `with-env` = `dotenv -e ../../.env -- dotenv -e ./.env --`.
Root loads first and `dotenv` does **not** override an already-set variable, so a
value in root `.env` wins over every app's own `.env` and silently collapses all
four apps onto one schema/prefix — exactly the collision this ADR exists to
prevent, but invisible (no error, just shared data). The root `.env` is for
genuinely shared infra only (DB host, Redis URL, S3, shared Stripe keys);
per-app values (`NEXT_PUBLIC_WEBAPP`, `PORT`, the port-specific
`STRIPE_SUCCESS_URL` / `STRIPE_CANCEL_URL` / `NEXT_PUBLIC_STRIPE_MANAGE_BILLING_URL`)
live in each app's own `.env`.

**Enforcement (fail-loud, not convention):** `NEXT_PUBLIC_WEBAPP` is validated as
`z.string().regex(/^[a-z][a-z0-9_]*$/)` in every package that reads it
(`@acme/redis`, `@acme/rag`, `chat`, `feedback`, `ingest`). A hyphenated or empty
value now throws at startup instead of producing a broken schema name. The root
`.env.example` documents the per-app rule, and the slim apps' `app-schema.ts` /
`drizzle.config.ts` fallbacks use the underscore form.

## Amendment — type-enforced key construction replaces the Proxy + allow-list

Decision 2 above (an allow-list-guarded `Proxy` rewrites the first argument of
known key/channel commands) was chosen over "an explicit `key()` helper at every
call site", which this ADR rejected as _leaky_: a missed call site "silently
writes an unprefixed, cross-app-colliding key." That objection rested on one
word — **silently**. The allow-list itself turned out to be the leak.

**The allow-list drifted, in shipped code.** `@acme/subscriptions` introduced
`redis.expireAt(...)` (in `overrideExpiry`) but `expireAt` was never added to
`KEY_COMMANDS`. So `expireAt` passed through the `Proxy` untouched and operated
on the **unprefixed** `credits:<user>:<tier>` key, while the value lived at the
prefixed key — the expiry override silently no-op'd on the real key and poked a
cross-app-colliding phantom. Exactly the corruption this ADR exists to prevent,
invisible to single-app tests, caused by the guardrail the ADR relied on.

**The fix turns the rejected alternative into the correct one by making the miss
a compile error instead of a silent runtime leak.** Keys are now constructed
through `nsKey(...parts)` (exported from `@acme/redis`), the single place the
prefix is applied and the only constructor of the branded `NamespacedKey` type.
Every key/channel command on the exported clients accepts **only** a
`NamespacedKey`, never a raw `string`. A forgotten prefix no longer compiles.

This supersedes decision 2 (the `Proxy` + `KEY_COMMANDS` / `CHANNEL_COMMANDS`
allow-list, now deleted). The other load-bearing decisions stand: the namespace
is still sourced from `NEXT_PUBLIC_WEBAPP` via `@acme/redis/env` (decision 1),
and an empty namespace still yields raw keys with no leading colon (decision 3) —
`nsKey` returns the bare key when the namespace is unset, so the test path is
unchanged.

Consequences:

- **No allow-list to maintain.** A new command cannot leak: it physically will
  not accept an un-namespaced key. The `expireAt`-class bug is now unrepresentable.
- **Key formats live in named builders, not inline templates.** `creditKey`
  (private to `@acme/subscriptions/credits`) and `stripeUserKey` /
  `stripeCustomerKey` (exported from `@acme/subscriptions`) build their keys
  through `nsKey`; the ~9 inline `` `stripe:user:${id}` `` call sites across
  `@acme/billing`, the account router, and the app-owned Stripe sync now route
  through them.
- **The namespace test is a pure unit test of `nsKey`** — no fake client, no
  Proxy behaviour to assert. Prefixing is a property of key construction.
- **One sanctioned cast.** Branding is a nominal-typing technique and needs a
  single `as NamespacedKey` inside `nsKey`; it is isolated to that one constructor.
- **`@acme/redis` exposes a thin typed facade** over the small command surface in
  use (`get`/`set`/`decrBy`/`incrBy`/`del`/`ttl`/`expire`/`expireAt`/`exists`,
  the `publish`/`subscribe`/… channel commands, and infra pass-throughs). It does
  no runtime rewriting — `nsKey` already prefixed the key — it only narrows the
  key parameter's type.

## Amendment — ioredis substrate (T1)

`@acme/redis` internal client was migrated from node-redis (`redis@4`) to ioredis
(`ioredis@5`). The facade surface — `nsKey`, `NamespacedKey`, `namespaced()`, and
all command method signatures — is unchanged, so no consumer was touched.

**Why ioredis.** BullMQ (the planned job-queue substrate for T2) requires an
ioredis client at its API boundary — it does not accept node-redis. Keeping two
separate Redis libraries (one for key/value, one for BullMQ) would fork the
connection pool, double local/infra surface, and complicate testcontainer setup.
A single ioredis substrate removes that split at the cost of a one-time migration.

**What changed internally.** The raw client is now `new Redis(url, { lazyConnect:
true })` (ioredis) instead of `createClient({ url, socket: { reconnectStrategy }
})` (node-redis). Connection management, error handling, and the `IS_NEXT_BUILD`
guard are identical in behaviour. The facade translates the small set of naming
differences between the two libraries: `flushdb` (ioredis) ↔ `flushDb`
(node-redis), `expireat` ↔ `expireAt`, `decrby`/`incrby` ↔ `decrBy`/`incrBy`,
`psubscribe`/`punsubscribe` ↔ `pSubscribe`/`pUnsubscribe`. The `set` facade method
translates `{ EXAT: timestamp }` (node-redis option object) to positional ioredis
args so existing callers (`@acme/subscriptions` credits, test assertions) are
unchanged. The `isOpen` infra getter returns `true` for all active connection
states (`ready`, `connect`, `connecting`, `reconnecting`) — broader than
node-redis's `isOpen` (which was `ready`-only) but required because ioredis
throws if `connect()` is called while already connecting. Commands issued in any
of these states are queued by ioredis and execute once the connection is ready,
so no caller is broken. The `connect()` wrapper is a no-op in those states.

**Pub/sub note.** The `redisPub`/`redisSub` clients and their channel commands
remain in the facade. The `subscribe`/`pSubscribe` wrappers attach ioredis
`message`/`pmessage` event listeners via a tracked Map so `unsubscribe`/
`pUnsubscribe` can remove the exact handler — preventing listener accumulation.
There are currently zero real consumers of pub/sub (it is reserved for T2).
