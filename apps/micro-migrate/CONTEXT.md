# micro-migrate

The one-shot DDL migrator for the opt-in microservices showcase ([ADR 0023](../../docs/adr/0023-opt-in-microservices-topology.md)).

In the monolith, an app's `instrumentation.ts` runs `ensureVectorIndex()` at
boot and its `db:push` creates the shared Postgres schema + app-owned tables. In
the microservices topology the service processes are stateless, so that DDL is
relocated here and run **once, before any service starts** (compose orders the
`migrate` service ahead of the hosts).

- `pnpm migrate` = `db:push` then `vector:index`.
- **`db:push`** creates the shared deployment schema (`NEXT_PUBLIC_WEBAPP`) and
  the app-owned tables re-exported from `src/schema.ts` — chat's `chat_folder`
  and feedback's `message_feedback` (ingest has none). `!mastra_*` keeps Mastra's
  runtime-owned tables untouched.
- **`vector:index`** runs `ensureVectorIndex()` so the pgvector store exists
  before the first read.

`NEXT_PUBLIC_WEBAPP` is the single deployment-wide namespace — the same value
every service uses (ADR 0023). The `server-only` stub (tsconfig `paths`) mirrors
`apps/service-host`, since the RAG graph carries the guard.
