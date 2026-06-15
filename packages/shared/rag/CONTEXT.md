# RAG (`@acme/rag`)

Shared primitives for retrieval-augmented generation and conversation memory on
Mastra. Provides the vector store, document uploader, and memory storage consumed
by the chat and ingest features. Provider-agnostic: chat and embedding models are
resolved by [`@acme/models`](../models/CONTEXT.md), not constructed here.

## Language

**Knowledge base**:
The collection of indexed Document chunks in the vector store (`PgVector`), queried
at chat time. Lives in its own vector database (`DB_VECTOR_NAME`).
_Avoid_: "index", "embeddings table"

**Thread**:
Mastra's unit of conversation persistence (`mastra_threads`), identified by a
`threadId`. The chat feature maps a Conversation onto a thread (`threadId =
sessionId`). _Avoid_: "chat row", "session table"

**Resource**:
Mastra's owner of threads (`mastra_resources`), identified by a `resourceId`. The
chat feature maps a user onto a resource (`resourceId = userId`).
_Avoid_: "account", "tenant"

**Per-app schema**:
The Postgres schema (`= NEXT_PUBLIC_WEBAPP`) every Mastra-owned table is namespaced
under, giving each app DB-level separation. Set via Mastra's `schemaName` option.
_Avoid_: "table prefix", "namespace prefix"

**Mastra-owned table**:
A table whose DDL Mastra creates at runtime (`PgVector`, `PostgresStore`). By
invariant every one is `mastra_`-prefixed — `mastra_documents` (the knowledge base),
`mastra_threads`, `mastra_messages`, `mastra_resources`. Drizzle only _mirrors_ these;
`db:push` is blacklisted from them. _Avoid_: "drizzle table", "our table"

**App-owned table**:
Any non-`mastra_` table in the per-app schema — the app, via Drizzle, owns its DDL.
`db:push` manages these freely (no migrations in dev); Mastra never touches them.
There are none today; the lane exists for future app tables. _Avoid_: "custom table"

**Embed purpose**:
Whether an embedding is for a stored document or a query — `document` when indexing,
`query` when retrieving. The uploader and vector query tool pass this to
`embedProviderOptions(purpose)` in [`@acme/models`](../models/CONTEXT.md), which
turns it into provider-specific options (Bedrock's Cohere `inputType`; nothing for
Ollama). The provider detail no longer lives here. _Avoid_: "input type" (that's a
Cohere-only detail), "mode", "direction"

## Relationships

- The document uploader parses a file (officeparser for `.pdf`/`.docx`, native read
  for `.txt`) → chunks it → embeds chunks via the active embed model from
  `@acme/models` → upserts into `PgVector` with deterministic UUIDv5 ids.
- `PostgresStore` backs Mastra `Memory`; together they own thread/message/resource
  persistence in the app database.
- Mastra creates every table at runtime; `@acme/rag/schema` exposes Drizzle mirrors
  of them so the data stays queryable. The matching migrations are generated but
  marked applied — see [system ADR 0002](../../../docs/adr/0002-mastra-rag-and-memory.md).

## Design decisions

**Models live in `@acme/models`, not here**: chat and embedding models are resolved
by `@acme/models` from an env-selected provider (Bedrock / OpenRouter / Ollama) and
passed to Mastra as AI-SDK instances. This package is provider-agnostic — it consumes
`embedModel` / `embedProviderOptions` and never names a provider. See
[ADR 0003](../../../docs/adr/0003-multi-provider-models.md).

**Mastra owns DDL; Drizzle mirrors are read models**: Mastra's stores create their
tables (all `mastra_*`-prefixed); the Drizzle mirrors exist only so the data is
queryable with Drizzle. Letting both own DDL would race and drift. `db:push` is
scoped off `mastra_*` so it can only manage app-owned tables — see [ADR 0002](../../../docs/adr/0002-mastra-rag-and-memory.md).

**Per-app separation via `schemaName`**: Mastra exposes no table-prefix hook, so
each app's tables live in a Postgres schema named after `NEXT_PUBLIC_WEBAPP`.

**Knowledge-base table created at boot, not on first upload**: PgVector creates
`mastra_documents` lazily (on the first upsert), so a freshly-pushed vector DB has
no table and reads (`listDocuments`) throw `relation … does not exist`. The app
calls `ensureVectorIndex()` at boot (Next.js `instrumentation.ts`) so the table
exists before any read; `uploadDocs` keeps its own call as a backstop. Reads stay
pure (no DDL on a read), and an unreachable vector DB fails at startup rather than
on the first request — the same contract as provider resolution. Still Mastra-owned
DDL, consistent with [ADR 0002](../../../docs/adr/0002-mastra-rag-and-memory.md).

**Boundary**: the Mastra `Agent`/`Mastra` instance is _not_ here — the shared layer
cannot import features. This package exports primitives; `@acme/chat` assembles the
agent and the root Mastra CLI scripts point at `packages/features/chat/src/mastra`.

**Embedding dimension is configured, not baked in**: the embed model determines the
vector dimension, so `EMBED_DIMENSIONS` is env-driven — defined in `@acme/models`
(imported from `@acme/models/env`, not its root, so this schema never triggers
provider resolution) and the single source of truth for both the `PgVector` index
(vector.ts) and the Drizzle mirror (documents-schema.ts). Switching embed model
means changing the dimension and
`db:push`-ing the schema again — acceptable because the dev DB is ephemeral with no
data worth migrating. A dimension mismatch against an existing index must fail with
an actionable error ("re-push the schema" / drop the index), never a raw pgvector
error.
