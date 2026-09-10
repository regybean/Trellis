# Testcontainer schemas are provisioned by the push app's `drizzle-kit push --force`

**Status:** accepted

A fresh testcontainer Postgres has no tables. The global-setup provisions them by
running `drizzle-kit push --force` against the **push app** — the app whose
aggregated Drizzle schema owns every push-managed table — with
`NEXT_PUBLIC_WEBAPP` set to the suite's isolated Postgres schema. One push
creates every push-managed table (the app aggregates each feature's schema) into
that schema. `with-env` is bypassed — `setup.ts` has already seeded the
container's `DB_*` into `process.env`, so drizzle-kit is invoked directly.

## The push app is discovered, never named

`findPushApp` reads it off disk rather than holding a name. The marker is the
push config itself: `drizzle.push.config.ts` is what the command below passes to
drizzle-kit, so an app that has one is an app that can serve the push, and the
first such app in sorted order wins.

A named app would be wrong twice over. This package is distributed content, so a
hardcoded app directory makes backend tests unrunnable in any repo whose apps are
called something else — `spawn` fails on a cwd that does not exist and reports it
as a missing `pnpm`, which is a long way from the actual cause. And an app is
consumer identity: a decision that has to name one is an app-layer decision, not
a test-harness one. Sorted-first is arbitrary on purpose. Where more than one app
aggregates the same push-managed tables, any of them provisions the same schema,
so there is nothing for a preference to be right about; where they differ, the
right fix is one app that owns the aggregate, not a tiebreak here.

An app set with no push config at all is an error rather than a silent skip:
backend tests need one app aggregating the push-managed schemas, and a suite that
quietly ran against an empty database would fail later and further away.

## Why push, not migrate — and why this was invisible

The previous global-setup ran `cd apps/$WEBAPP && pnpm db:migrate`. It was broken
two ways, and both were **masked by the Turbo cache**:

- The apps' `migrations/db` holds **no SQL** — this repo is push-based, so
  `drizzle-kit migrate` applied nothing and created no tables.
- `$WEBAPP` is the suite's **schema name** (`feedback_test`, `billing_test`, …),
  not an app — `cd apps/feedback_test` failed outright. Only the suites whose
  `webapp` value happened to name a real app directory resolved one at all.

The migrate step ran **only** under testcontainers (`useTestcontainers`), so it
only ever executed in CI — and CI served cache hits populated by local compose
passes, so it never actually ran. The entire backend-testcontainer
provisioning path was dead and undetected until the test cache was partitioned
so worktrees exercised it. `push` reads `schema.ts`
directly and force-syncs it — the same declarative sync dev relies on — so it
works with an empty migrations dir.

## One global push, not per-suite self-provision

Provisioning lives once in the global-setup, keyed off the push app's aggregated
schema — **migrations are app-owned**, and that app's `schema.ts` already
re-exports every feature's push-managed tables. The previously-documented
alternative — each suite deriving its own DDL via `drizzle-kit/api`
`generateMigration` — is removed: it duplicated the app's
schema ownership per suite and left the other suites unprovisioned. Mastra
(`mastra_*`) and pgvector tables are created lazily at runtime and excluded by the
push config's `tablesFilter`, so push never manages them.

## Consequences

- Every suite's isolated schema receives **all** the push app's push-managed
  tables, not just its own — harmless redundancy (a feature suite gets other
  features' tables too), the price of a single app-owned push.
- A feature with push-managed tables must be re-exported from the push app's
  `schema.ts` to be provisioned in tests — the same requirement production has.
- Provisioning is unconditional: every backend suite starts a fresh Postgres and
  pushes into it on every run, everywhere and identically, with no local stack to
  prefer. The compose path that skipped this step — and the script that existed
  to make its "dev `db:push` already ran" assumption true for the isolated
  `*_test` schemas — are both gone.

## Amendment — one pushed schema is _not_ per-suite, and cleanup has to know it

The consequences above assume every push-managed table lands in the suite's
isolated `NEXT_PUBLIC_WEBAPP` schema. That is no longer true of all of them:
identity tables live in a dedicated schema, decided by the auth package and
recorded in its own ADRs, so an app's `schemaFilter` reads
`[NEXT_PUBLIC_WEBAPP, 'auth']` and `db:push` also provisions the four identity
tables into a **constant `auth` schema** shared by every app and every suite.

Push is unaffected — it creates both schemas as before. What changes is
**teardown**. Per-suite isolation is what makes a blanket delete safe, and the
`auth` schema does not have it: on the testcontainer path the schema is
throwaway, but on a developer's local Postgres it holds their actual identity
rows, so `DELETE FROM auth.user` would wipe real data.

So a suite touching the identity tables deletes by a **marker it owns**, not by
table. `@acme/auth`'s suite gives every user it creates an address on
`TEST_EMAIL_DOMAIN` (`auth-suite.invalid`) and cleans up with a `LIKE` on that
domain; `session` and `account` cascade from `user`. Any future suite writing to
a constant shared schema owes the same discipline — the isolation this ADR
otherwise guarantees is not there to fall back on.
