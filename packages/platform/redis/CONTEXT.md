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

**Compare-and-delete** (`redis.compareAndDelete(key, expected)`):
The owner-checked release for a **value-owned lock** — a key whose _value_ names
its owner (`SET key owner NX EX`, chat's In-flight lock). Deletes the key only
while it still holds `expected`, and reports whether this caller's value was the
one deleted. Server-side (a two-line Lua `EVAL`), because the client-side `GET`
then `DEL` it replaces is a different operation: a TTL that lapses between the two
round trips lets a NEW owner acquire the key, and the old owner's `DEL` then
deletes _their_ lock. Redis has no native compare-and-delete, so Lua is the
canonical tool (`WATCH`/`MULTI` is more code for the same guarantee).
_Avoid_: "safe delete", "release" (whose?); reading a lock then deleting it in two
calls.

**Durable stream** (`createDurableStream`, `durable-stream.ts`):
The one per-user (or per-conversation) Redis-Stream primitive behind chat's
token stream, ingest's progress stream, and the notifications stream (#196). It
owns the transport those three used to hand-copy: `write` (the atomic
append-with-rolling-TTL `xAddWithTtl`), `lastId` (the "actual last stream id"
read via `xRevRange` — a real Redis-assigned id, so a fresh tail-from-now seed
never uses the app clock), `read` (a decoded full-range fold, e.g. ingest's cold
snapshot), and `tail(startCursor, { keepGoing?, transform?, pollMin/MaxMs })` —
the XRANGE poll loop with idle backoff, an abort-aware `delay`, and the exclusive
`(cursor` resume. Each caller supplies only what is genuinely its own: a
`StreamCodec<T>` (`encode`/`decode` off its own zod schema — the primitive folds
the raw `[k,v,…]` field array to a record first), the fresh-connect cursor-seed
policy (passed as `startCursor` — `HEAD_CURSOR` = the head), and optionally a
`keepGoing(cursor)` predicate (chat's in-flight-Turn lock probe — return `false`
takes one more drain then closes) and a `transform` (chat's delta-coalesce).
_Avoid_: "the stream helper", "the reader" (which half?).

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

**The facade does no runtime work — except where atomicity demands it**: `nsKey`
already applied the prefix, so the client wrapper only narrows the key parameter's
type and delegates. The exposed surface is the small set of commands actually in
use plus infra pass-throughs. The exceptions are the ops that exist _because_ a
multi-step sequence must not be interleaved — `xAddWithTtl` (append + restamp TTL
in one `MULTI`) and **compare-and-delete** (one `EVAL`). Those belong here rather
than in the caller: a read-then-act pair assembled at a call site is only correct
by luck, and every caller would have to re-derive the same guarantee.

**One sanctioned cast**: branding is nominal typing and needs a single
`as NamespacedKey` inside `nsKey`, isolated to that one constructor.

**`REDIS_URL` is authored config, and this is its home** (`env.ts`, ADR 0033 /
#124): the whole DSN is authored in the development profile as
`redis://localhost:6379`, so dev needs no `.env` row, and a same-named variable
retunes it — which is what the _dynamic_ cases need (a testcontainer's mapped
port, an infra-injected prod endpoint), re-validated as a URL rather than passed
through raw. `src/development-profile.ts` holds the literal so
`scripts/resolve-compose-env.ts` can parse the local port out of it without
evaluating this slice's env. `REDIS_URL` is a `server` key (reading it in browser
code throws). Other Redis-touching packages don't
re-declare it: `@acme/queue` imports the resolved value from `@acme/redis/env`
(as `@acme/rag` imports `@acme/db/env`); the app's remaining slices carry no
`REDIS_URL` env row at all.
