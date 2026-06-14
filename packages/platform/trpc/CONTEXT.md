# Platform tRPC (`@acme/trpc`)

The single source of the tRPC initialization and request-pipeline middleware that
every feature reuses. It owns _how_ a request is authenticated, traced, timed and
rate-limited — not _what_ any feature does with it.

## Language

**Feature tRPC**:
The per-feature tRPC instance (router, procedures, context) produced by one call to
`createFeatureTRPC` or `createFeatureTRPCWithDb`. Each feature has exactly one.
_Avoid_: "the tRPC setup", "the router config"

**Base context**:
The request context every procedure receives — Clerk `auth`, `user`, billing context
(`subscription`/`tier`/`credits`), and `telemetry`.
_Avoid_: "the session"

**Billing context**:
The `subscription` / `tier` / `credits` triple. Always fetched eagerly per-request
from Redis via `@acme/subscriptions`. Every feature pays this cost; no opt-out.

**Protected procedure**:
A procedure requiring an authenticated Clerk user (`isAuthed`).

**Admin procedure**:
A procedure requiring `auth.sessionClaims.metadata.role === 'admin'` (`isAdmin`).

**Rate limit**:
Token-bucket middleware (`rateLimit({ credits })`) that decrements a per-user,
per-tier credit count in Redis.

**Require tier**:
Tier-gate middleware factory (`requireTier(minTier)`) that admits a request only if
`ctx.tier` is at least `minTier` in the tier ordering. Reads from the already-assembled
Billing context — no Redis or Stripe I/O. Composed onto a feature's `protectedProcedure`,
exactly like `rateLimit`.

## Relationships

- A **Feature tRPC** is produced by either `createFeatureTRPC()` (no DB) or
  `createFeatureTRPCWithDb(db)` (DB-backed)
- `createFeatureTRPCWithDb` instruments the Drizzle client for OpenTelemetry and
  injects it as `ctx.db` (typed to the feature's schema `TDb`) via a middleware on
  every procedure
- Every procedure receives the **Base context**, which always contains a **Billing context**
- **Admin procedure** and **Protected procedure** build on the public procedure (telemetry + timing middleware)
- **Rate limit** reads `credits`/`tier` from the **Billing context**
- **Require tier** reads `tier` from the **Billing context** and delegates the ordering
  comparison to `isTierAtLeast` in `@acme/subscriptions`

## Design decisions

**Billing context is always eager**: every feature always performs the Redis subscription
lookup in `createTRPCContext`. No opt-out callback. The simplicity of a single code path
outweighs the minor Redis cost for features that don't gate on subscription.

**Two factories instead of one generic**: a generic context parameter
(`initTRPC.context<TContext>()`) makes tRPC's middleware conditional types explode.
The core tRPC instance is built against a _concrete_ `BaseContext`; the DB variant
layers `ctx.db` on via a middleware whose only generic surface is a simple `{ db: TDb }`
context override. This keeps the type machinery shallow and the build fast.

**DB is caller-created**: features instantiate their own Drizzle client (from their own
env/schema) and pass it to `createFeatureTRPCWithDb`. The factory instruments it and
injects it; features own the connection config and schema.
