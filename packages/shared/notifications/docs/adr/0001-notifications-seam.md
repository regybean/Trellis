# `@acme/notifications`: a `shared` package that owns a tRPC router

**Status:** accepted (authored on package creation, per spec #185 / ticket #186)

> **Amended #196** — Decision 2's reader is now the shared `@acme/redis`
> durable-stream primitive ([@acme/redis ADR 0001](../../../../platform/redis/docs/adr/0001-durable-redis-stream-primitive.md)),
> not a hand-copied `xRange` poll loop. Two specifics are **replaced**: the
> fresh-connect seed is no longer `${Date.now()}-0` but the stream's **actual last
> id** (read via `xRevRange` — the "no `xRevRange`, no new `@acme/redis` surface"
> line no longer holds; the surface was added precisely to kill the clock-skew
> failure the app-clock seed could hit under podman-VM drift, the same class ingest
> fixed in #194); and `publish` writes through the atomic `xAddWithTtl` rather than
> a non-atomic `xAdd` + `expire`. The **tail-from-now intent** — a leave-and-return
> shows nothing (Decision 4's no-durability contract) — is unchanged, now preserved
> via the last-id seed instead of the wall clock.

## Context

Async features need to tell a user "your background work finished." Chat welds
this into its own feature (its own stream, its own terminal). A generic per-user
notification + toast primitive is needed, and it is the first case in the repo of
a package that is _neither_ a feature _nor_ platform:

- features must `publish()` into it, so it **can't be a feature** — feature→feature
  is boundary-illegal (turbo.json `feature.dependents.allow = [app]`); and
- it owns a `'use client'` tRPC connector + provider, so it **can't be platform** —
  the substrate layer must never ship React or own a router.

Ingest (spec #185) is its first consumer; the primitive is the durable win.

## Decision

1. **Layer = `shared`.** `shared` is importable by features and apps, may ship
   React, and keeps the platform-purity invariant intact (platform still never
   owns a router or ships React). `@acme/notifications` is the first `shared`
   package to own a tRPC router and the first cross-cutting per-user subscription.

2. **Chat-mirror vertical, own endpoint.** It exports a concrete
   `appRouter = createTRPCRouter({ notifications: notificationsRouter })` +
   `createTRPCContext`, mounted at its own **`/api/trpc/notifications`** in all 4
   apps (there is no aggregated root router in this repo — each feature/seam mounts
   its own). The subscription is `protectedProcedure`, `userId` from
   `ctx.session.user.id` (never a client input). The reader is a pure `xRange`-polling
   generator: tail-from-now on a fresh connect (seed cursor `${Date.now()}-0`),
   exclusive `(cursor` resume on transient reconnect, idle backoff, never
   self-closes (abort only). It builds on the db-less `createFeatureTRPC()`.

3. **Open envelope, core owns the envelope not the kinds.** A closed discriminated
   union is impossible (`shared` can't import feature payloads). The core owns
   `{id, kind: string, level, message, createdAt, data?}`; per-consumer
   discrimination happens **at the app** via a `renderers` registry keyed by
   `kind`, where feature schemas are importable. Features add kinds with zero core
   change. `data` is opaque — a custom renderer zod-parses its own.

4. **`publish` is the sole writer; the app owns dispatch.** `publish(userId,
input)` is the only `xAdd`: it mints `id` (`randomUUID` → the react-toastify
   `toastId`) + `createdAt` (server clock), validates, writes the whole envelope as
   a single `payload` JSON field, and refreshes a rolling 1h `EXPIRE` (no `MAXLEN`).
   There is **no core "kind factory"** — a feature writes its own one-line typed
   wrapper. The app assembles the `kind`→renderer map and mounts the
   `<NotificationsProvider>` (a self-contained tRPC provider + headless always-on
   tail child); chrome is app-owned. Dispatch is factored as an independently
   callable function so the un-drivable SSE tail isn't in the way of a test.

## Consequences

- **Positive:** one reusable per-user delivery primitive; features add notification
  kinds without touching the core; the platform-purity invariant is preserved by
  placing the router-owning package in `shared`, not platform. The mount is
  byte-identical across all 4 apps (no persister, no `scopeKey`, no client
  principal).
- **Accepted — slim per-user bleed.** The slim apps inject a constant
  `{userId:'local'}` at the tRPC route seam, so all slim visitors share one
  `notifications:local` stream and would see each other's toasts. Accepted (the
  same no-auth collapse chat/ingest already accept; per-user keying is correct
  where identity is real).
- **Accepted — no durability.** A `publish` with no page open is never delivered
  (leave-and-return shows nothing) — "exactly-one" means per-connected-reader once,
  no cross-tab coordination or consumer groups. An inbox / notification-center is
  explicitly out of scope; there is no consumer hook.

## Amendment (#264) — the two `@acme/trpc` symbols decision 2 names are gone

Decision 2 still holds in full: `@acme/notifications` exports a concrete
`appRouter` mounted at its own `/api/trpc/notifications` in all four apps, the
subscription is `protectedProcedure`, and `userId` comes off `ctx.session.user.id`.
The platform still owns no router and ships no React.

Two names in it are stale. `createTRPCContext` no longer exists — a `./server`
barrel exports the router alone, and each app's mount names one of its own
resolvers, checked against the router's context. `createFeatureTRPC()` no longer
exists either: this package builds its own instance from `trpcConfig` and the
shared middleware bodies, against a `NotificationsContext` that is exactly
`BaseContext` — it still owns no database. See the
[#264 amendment to ADR 0006](../../../../../docs/adr/0006-entitlements-injection-seam.md).
