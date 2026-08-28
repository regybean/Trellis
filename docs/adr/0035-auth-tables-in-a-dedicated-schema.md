# Auth tables live in a dedicated `auth` schema, outside the per-app one

Every app-owned table in this repo is namespaced under
`pgSchema(process.env.NEXT_PUBLIC_WEBAPP)`: one Postgres instance, four apps,
four schemas, no cross-app reads. [ADR 0008](0008-per-app-redis-namespace.md)
names that construct — _one app-identity value partitions every shared
datastore_.

Better Auth's four tables (`user`, `session`, `account`, `verification`) are the
**deliberate exception**. They live in a constant `auth` schema:

```ts
export const authSchema = pgSchema("auth");
```

## Why identity is different

A person who signs in to `nextjs` and to `tanstack-start` is one person. Under
the per-app rule they would be four rows, four password hashes, four sets of
sessions, and four separate password resets — and "log in once" across the 2×2 of
apps would be impossible by construction. The partitioning rule exists to stop
apps reading _each other's domain data_; identity is not domain data, it is the
thing the domain data is keyed by.

AIA made the same call independently, which is weak evidence but not zero.

## What this costs

**The apps are no longer separable on one database.** Under Clerk, each app
could point at its own Clerk instance and have a genuinely separate user base.
Now four apps sharing a Postgres share an identity store. That is the intent, but
it is a behaviour change and the reason this needs writing down: an app that
truly needs an isolated user base needs its own database, not its own schema.

**`schemaFilter` grows a second entry.** drizzle-kit only manages schemas listed
in `schemaFilter`, so both full apps' `drizzle.config.ts` now read
`[NEXT_PUBLIC_WEBAPP, 'auth']`. Without the second entry push silently ignores
the auth tables — no error, just no tables. Both apps also re-export the tables
from their `src/server/db/schema.ts` (including `authSchema` itself, so drizzle
owns `CREATE SCHEMA auth`), which is what brings them under push at all
([ADR 0021](0021-test-schema-provisioning-db-push.md)).

**Both full apps push the same four tables.** Idempotent — identical desired
state from one shared package — but it does mean the DDL has two owners in
practice. A per-app-schema table has one.

**Test cleanup can no longer be `DELETE FROM`.** Every other backend suite runs
against its own `*_test` schema and truncates freely. The `auth` schema is
shared, so on the local compose path a blanket delete would wipe a developer's
real identity rows. The suite instead creates users on a reserved email domain
and deletes only those; `session` and `account` cascade from `user`.

## Hand-authored, not generated

The four tables are written by hand rather than produced by
`@better-auth/cli generate`. Better Auth 1.7's drizzle adapter _does_ accept a
`schemaName` for CLI generation, so "the CLI can't emit `pgSchema()`" is no
longer the reason — the reason is that wiring a codegen step for four small
tables buys nothing, and its output would still need editing to match repo
conventions (`timestamptz` rather than naive `timestamp`, the `auth*` export
names that keep `user`/`session` from colliding in a consumer's import scope).

The contract with Better Auth is subtle enough to record: the Drizzle adapter
resolves columns as `schema[model][field]`, where `field` is Better Auth's field
name — camelCase by default. So the **property keys** are fixed by Better Auth
(renaming one breaks auth at runtime, not at compile time) while the SQL column
names are ours. The backend suite is what proves the whole cross-schema mapping
resolves, including a direct `information_schema` assertion that the four tables
are in `auth` and not in the suite's per-app schema.

## Status

accepted

## Considered and rejected

- **Per-app auth tables** (follow ADR 0008 without exception). Consistent, and
  keeps every table under one rule. Rejected: it makes one human four users, and
  makes shared sign-in impossible rather than merely unimplemented.
- **A separate `auth` _database_, not a schema.** Stronger isolation, and the
  right answer if identity ever needs separate credentials or backup policy.
  Rejected for now: it forks the connection factory (`createDb({ database })`
  exists, but every consumer would need to know which database it is talking to)
  for isolation nothing currently asks for.
- **Sourcing the schema name from env** (`AUTH_SCHEMA`). Rejected: a per-deploy
  override is exactly the footgun ADR 0008's amendment describes — two apps
  resolving different values would silently split the identity store, with no
  error.
