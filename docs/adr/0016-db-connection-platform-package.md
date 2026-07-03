# Postgres connection lives in a platform package (`@acme/db`), peer to `@acme/redis`

Postgres gets a first-class platform home — `@acme/db` — owning the
drizzle/postgres-js **connection** (a client factory) and the `DB_*` connection
**env**, exactly mirroring how `@acme/redis` owns the Redis clients + env. It is
created to remove a real duplication, not for tests; the test descriptor
([ADR 0017](0017-test-infra-owned-by-infra-package.md)) only follows for free.

## The asymmetry it fixes

Redis had one home (`@acme/redis`: client + env + `nsKey`); Postgres had none.
The connection was reconstructed in four places — `drizzle({ host: env.DB_HOST,
… })` in `@acme/billing`, `@acme/chat`, `@acme/feedback` (`api/trpc.ts`) and again
as `vdb` in `@acme/rag` — and the `DB_HOST/PORT/USER/PASSWORD/NAME` schema was
re-declared in four `env.ts` files. `@acme/db` collapses both: features import the
factory and drop `DB_*` from their own `env.ts`; `@acme/rag` imports `@acme/db/env`
for the connection values.

## Boundary: connection + env only

`@acme/db` owns the connection substrate — nothing above it.

- **Features keep their own table schemas.** This is the direct parallel to the
  Redis **key builder** rule ([ADR 0008](0008-per-app-redis-namespace.md)):
  `@acme/db` owns *how you connect*, the domain package owns *what it stores*.
- **`@acme/rag` keeps its Mastra `pgVector` / `postgresStore`.** Those are
  `@mastra/pg` constructs, vendor-contained to rag ([ADR 0002](0002-mastra-rag-and-memory.md));
  moving them into `@acme/db` would couple the platform substrate to Mastra. They
  read host/creds from `@acme/db/env` and stay put.
- **No `vdb` package.** The vector database (`DB_VECTOR_NAME`) has exactly one
  consumer (rag). A package with a single consumer would only externalise rag's
  internals. Instead the `@acme/db` factory takes a database name
  (`createDb({ database })`); rag calls it with `DB_VECTOR_NAME` for its direct
  vector connection and keeps `DB_VECTOR_NAME` in `rag/env` as a rag-specific value.
- **Migration stays app-level.** `@acme/db` does not (yet) own the migration
  runner; apps keep `db:migrate` and `drizzle.push.config.ts`. The
  `@acme/test-utils` → `apps/$WEBAPP` `db:migrate` reach is unchanged and left as a
  separate, later decision.

## Status

accepted

## Considered and rejected

- **Leave Postgres in `@acme/rag`.** Rejected — rag is a `shared`-layer *feature*
  concern (RAG), yet `@acme/billing`/`@acme/chat`/`@acme/feedback` already reach
  through it for a plain connection. Connection is substrate, not a RAG concern; it
  belongs in `platform` beside `@acme/redis`.
- **`@acme/db` absorbs rag's `pgVector`/`postgresStore` too** (single Postgres
  owner). Rejected — breaks vendor containment (ADR 0002) and couples the platform
  substrate to `@mastra/pg`.
- **A separate `vdb` package** for the vector database. Rejected — one consumer;
  fails to earn its keep. Parameterise the factory by database name instead.
