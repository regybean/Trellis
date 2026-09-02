# Mounting `@acme/redis`

**No app mounts this package.** It is the one runtime package out of nineteen
that no app under `apps/*` depends on directly, so there is no route handler and
no provider to copy. Inventing one here would document wiring that does not
exist.

What an app actually does is mount a package that consumes it, set
`NEXT_PUBLIC_WEBAPP`, and start the `redis` compose service.

## Mounted by

Packages, not apps:

| Consumer              | What it uses                                          |
| --------------------- | ----------------------------------------------------- |
| `@acme/queue`         | the connection BullMQ runs on, and the per-app prefix |
| `@acme/subscriptions` | the Credit ledger and subscription cache (`credits`)  |
| `@acme/notifications` | the per-user notification stream                      |
| `@acme/chat`          | Turn lifecycle keys + the durable token stream        |
| `@acme/ingest`        | the per-user upload-progress stream                   |

`@acme/billing` lists it as a dependency for its backend test harness
(`vitest.config.backend.ts`, `tests/backend/*`) rather than in `src/`.

So: if your app mounts `@acme/chat`, `@acme/ingest`, `@acme/notifications` or
anything on the `@acme/queue` / `@acme/subscriptions` path, you have mounted
`@acme/redis` transitively and the two obligations below are yours.

## Glue

### 1. `NEXT_PUBLIC_WEBAPP` — the namespace, not a nicety

Every key is built by `nsKey`, which prefixes it with `NEXT_PUBLIC_WEBAPP`
(ADR 0008). All apps here share one Redis instance, so without a distinct value
per app two apps collide on the same keys. The apps set it in `deploy/.env`
alongside the compose stack; it is also the per-app Postgres schema name, so it
carries a Postgres-identifier constraint (`webappSchema` in `@acme/env`).

An empty namespace yields raw, unprefixed keys — that is the test path, not a
deployment option.

### 2. Domain key builders live in your package, not here

```ts
// packages/features/chat/src/api/chat-keys.ts
import { nsKey } from '@acme/redis';
```

`nsKey` returns a branded `NamespacedKey`; every key-bearing client method
demands one, so passing a raw `string` is a compile error rather than a silent
cross-app collision. A consumer adding its own keys writes its own
`*-keys.ts` next to the feature that owns them.

### 3. Tests provision their own container

`@acme/redis/testing` is the testcontainer descriptor backend suites use, so a
consumer's test setup starts a throwaway Redis rather than sharing the dev one
(ADR 0034).

## Env

Factory: `src/env.ts`, exported as `@acme/redis/env`.

| Key                  | Kind     | Notes                                                        |
| -------------------- | -------- | ------------------------------------------------------------ |
| `REDIS_URL`          | config   | authored `redis://localhost:6379`; env-overridable           |
| `NEXT_PUBLIC_WEBAPP` | selector | app identity → the key prefix; written longhand for inlining |
| `NODE_ENV`           | selector | shared                                                       |

No secrets. The local container's password, when set, comes from `deploy/.env`
and rides the DSN.

These keys reach an app through whichever consumer it mounts — the app's own
`env.ts` does not `extends` this factory.

## Infra

`acme.infra: ["redis"]` → the `redis` profile in `deploy/compose.yaml`
(`redis:alpine`, published on the port parsed out of `REDIS_URL`, so `6379` by
default). `pnpm infra:up` derives the profile set from the union of `acme.infra`
across the app's workspace closure (ADR 0009), so mounting any consumer above
pulls this container in with no compose edit.

## Also mount

`@acme/logger` (connection-state logging), `@acme/env` (its env factory).
