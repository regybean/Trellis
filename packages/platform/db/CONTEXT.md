# Platform DB (`@acme/db`)

The shared Postgres connection substrate, peer to `@acme/redis`. It owns _how you
connect_ to Postgres — the drizzle/postgres-js client factory and the `DB_*`
connection env.

## Language

**`createDb({ database })`** (`@acme/db`):
The one place a Drizzle (postgres-js) client is built. Reads host/port/credentials
from `@acme/db/env`; `database` defaults to the application database (`DB_NAME`).
Callers that need another database on the same server pass it explicitly — the
sole such caller is `@acme/rag`, which connects to the vector database
(`DB_VECTOR_NAME`). This parameterisation is why there is **no `vdb` package**.
_Avoid_: "the db client", "the connection" (be specific: the factory vs an instance)

**Connection env** (`@acme/db/env`):
The single home for `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME`,
mirroring how `@acme/redis/env` owns `REDIS_URL`. `@acme/rag` imports it for
connection values and keeps only `DB_VECTOR_NAME` (+ chunking) as rag-specific env.
_Avoid_: "the db config"

**`postgresContainer`** (`@acme/db/testing`):
The pure-data Postgres test descriptor a backend suite opts into via
`backendProject({ infra: [postgresContainer] })`. Owned here, beside the
connection it serves; `@acme/test-utils` is the engine that starts it.

## Relationships

- **Connection is substrate, not a RAG concern.** `@acme/billing`, `@acme/chat`,
  `@acme/feedback` and `@acme/rag` all build their client via `createDb`.
- **Table schemas stay with the domain package.** `@acme/db` owns the connection;
  `@acme/chat` / `@acme/feedback` / `@acme/rag` own their `pgSchema` / `pgTable`
  definitions — the direct parallel to Redis's **Key builder** rule.
- **The vector store stays in `@acme/rag`.** `PgVector` / `PostgresStore` are
  `@mastra/pg` constructs, vendor-contained to rag; they read host and credentials
  from `@acme/db/env` but do not live here.
- **Migration is app-owned.** `@acme/db` does not run migrations; apps keep
  `db:migrate` + `drizzle.push.config.ts`.

## Decisions

See [`docs/adr/`](docs/adr/).
