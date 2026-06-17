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
   Tests mock `@acme/redis/env` *without* a `NEXT_PUBLIC_WEBAPP` field, so the
   namespace is absent and keys stay raw. This is deliberate: tests are
   app-agnostic and must pass regardless of prefix, and a no-prefix test keyspace
   keeps the test harness's own isolation (per-package logical DB `/N` +
   `flushDb`) independent of the app-identity mock.

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
  *happen* to share `NEXT_PUBLIC_WEBAPP`, but coupling the Redis prefix to the
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
