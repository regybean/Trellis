# RAG (`@acme/rag`)

Shared primitives for retrieval-augmented generation and conversation memory on
Mastra, wired to AWS Bedrock. Provides the vector store, document uploader, memory
storage, and Bedrock model providers consumed by the chat and ingest features.

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

**Input type**:
Cohere's asymmetric-embedding distinction — `search_document` when indexing,
`search_query` when querying — passed through `providerOptions.bedrock.inputType`.
(Bedrock's `embeddingPurpose` option is Nova-only and ignored for Cohere, so it is
not used.) _Avoid_: "embedding purpose", "mode", "direction"

## Relationships

- The document uploader parses a file (officeparser for `.pdf`/`.docx`, native read
  for `.txt`) → chunks it → embeds chunks via Bedrock Cohere → upserts into `PgVector`
  with deterministic UUIDv5 ids.
- `PostgresStore` backs Mastra `Memory`; together they own thread/message/resource
  persistence in the app database.
- Mastra creates every table at runtime; `@acme/rag/schema` exposes Drizzle mirrors
  of them so the data stays queryable. The matching migrations are generated but
  marked applied — see [system ADR 0002](../../../docs/adr/0002-mastra-rag-and-memory.md).

## Design decisions

**Bedrock via AI-SDK provider instance**: Mastra's model router has no native
Bedrock entry, so `@ai-sdk/amazon-bedrock` provider instances are passed directly as
the chat model (Claude) and embedding model (Cohere `embed-english-v3`, 1024 dims).

**Mastra owns DDL; Drizzle mirrors are read models**: Mastra's stores create their
tables (all `mastra_*`-prefixed); the Drizzle mirrors exist only so the data is
queryable with Drizzle. Letting both own DDL would race and drift. `db:push` is
scoped off `mastra_*` so it can only manage app-owned tables — see [ADR 0002](../../../docs/adr/0002-mastra-rag-and-memory.md).

**Per-app separation via `schemaName`**: Mastra exposes no table-prefix hook, so
each app's tables live in a Postgres schema named after `NEXT_PUBLIC_WEBAPP`.

**Boundary**: the Mastra `Agent`/`Mastra` instance is _not_ here — the shared layer
cannot import features. This package exports primitives; `@acme/chat` assembles the
agent and the root Mastra CLI scripts point at `packages/features/chat/src/mastra`.

**Embedding dimension is configured, not baked in**: the embed model determines the
vector dimension, so `EMBED_DIMENSIONS` is env-driven and is the single source of
truth for both the `PgVector` index (vector.ts) and the Drizzle mirror
(documents-schema.ts). Switching embed model means changing the dimension and
`db:push`-ing the schema again — acceptable because the dev DB is ephemeral with no
data worth migrating. A dimension mismatch against an existing index must fail with
an actionable error ("re-push the schema" / drop the index), never a raw pgvector
error.
