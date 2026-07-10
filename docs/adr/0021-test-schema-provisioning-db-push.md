# Testcontainer schemas are provisioned by the app's `drizzle-kit push --force`

A fresh testcontainer Postgres has no tables. The global-setup provisions them by
running `drizzle-kit push --force` against the **canonical full app** (`nextjs`),
with `NEXT_PUBLIC_WEBAPP` set to the suite's isolated Postgres schema. One push
creates every push-managed table (the app aggregates each feature's schema) into
that schema. `with-env` is bypassed — `setup.ts` has already seeded the
container's `DB_*` into `process.env`, so drizzle-kit is invoked directly.

## Why push, not migrate — and why this was invisible

The previous global-setup ran `cd apps/$WEBAPP && pnpm db:migrate`. It was broken
two ways, and both were **masked by the Turbo cache** ([ADR 0019](0019-worktrees-mirror-ci-test-infra.md)):

- `apps/nextjs/migrations/db` holds **no SQL** — this repo is push-based, so
  `drizzle-kit migrate` applied nothing and created no tables.
- `$WEBAPP` is the suite's **schema name** (`feedback_test`, `billing_test`, …),
  not an app — `cd apps/feedback_test` failed outright. Only `chat`/`rag`
  (`webapp: 'nextjs'`) even resolved a directory.

The migrate step runs **only** under testcontainers (`useTestcontainers`); the
local compose path skips it, assuming a dev `pnpm db:push` already ran. So the
step only ever executed in CI — and CI served cache hits populated by local
compose passes, so it never actually ran. The entire backend-testcontainer
provisioning path was dead and undetected until [ADR 0019](0019-worktrees-mirror-ci-test-infra.md)
partitioned the cache and made worktrees exercise it. `push` reads `schema.ts`
directly and force-syncs it — the same declarative sync dev relies on — so it
works with an empty migrations dir.

## One global push, not per-suite self-provision

Provisioning lives once in the global-setup, keyed off the app's aggregated
schema — **migrations are app-owned** (per CLAUDE.md), and `nextjs/schema.ts`
already re-exports every feature's push-managed tables. The previously-documented
alternative — each suite deriving its own DDL via `drizzle-kit/api`
`generateMigration` (feedback's `setup.ts`) — is removed: it duplicated the app's
schema ownership per suite and left the other suites unprovisioned. Mastra
(`mastra_*`) and pgvector tables are created lazily at runtime and excluded by the
push config's `tablesFilter`, so push never manages them.

## Status

accepted

## Consequences

- Every suite's isolated schema receives **all** the app's push-managed tables,
  not just its own — harmless redundancy (a feature suite gets other features'
  tables too), the price of a single app-owned push.
- A feature with push-managed tables must be re-exported from `nextjs/schema.ts`
  to be provisioned in tests — the same requirement production has.
- The local compose path still skips provisioning in the global-setup (assumes
  dev `db:push`); this ADR only governs the fresh-container path. That assumption
  is made true for isolated `*_test` schemas by `pnpm db:push`, which — after the
  four app-schema pushes — reuses the canonical app's own `db:push` per test
  schema (`NEXT_PUBLIC_WEBAPP` overridden; `scripts/push-test-schemas.sh`).
  Without it, chat/rag (`webapp: 'nextjs'`) pass off the app schema while a suite
  pinned to its own `*_test` schema finds no tables locally. `pnpm dev` pushes
  via the per-app scripts, not the root one, so its boot is unaffected.
