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
under, giving each app DB-level separation.
_Avoid_: "table prefix", "namespace prefix"

**Mastra-owned table**:
A table whose DDL Mastra creates at runtime (`PgVector`, `PostgresStore`). By
invariant every one is `mastra_`-prefixed — `mastra_documents` (the knowledge base),
`mastra_threads`, `mastra_messages`, `mastra_resources`.
_Avoid_: "drizzle table", "our table"

**App-owned table**:
Any non-`mastra_` table in the per-app schema — the app, via Drizzle, owns its DDL.
The first is `message_feedback`, defined in
[`@acme/feedback`](../../features/feedback/CONTEXT.md). _Avoid_: "custom table"

**Thread ownership**:
The fact that a Mastra **thread** belongs to a **resource** (`thread.resourceId ===
userId`). Mastra rows carry no row-level auth, so this is a rule, not a constraint:
`assertThreadOwned(threadId, userId)` reads the thread and either returns it, returns
`null` (absent), or throws `ThreadOwnershipError` (owned by someone else).
_Avoid_: "auth check", "guard" (it's a domain rule any feature can reuse)

**Embed purpose**:
Whether an embedding is for a stored document or a query — `document` when indexing,
`query` when retrieving. The uploader and vector query tool pass this to
`embedProviderOptions(purpose)` in [`@acme/models`](../models/CONTEXT.md), which
turns it into provider-specific options. _Avoid_: "input type" (that's a Cohere-only
detail), "mode", "direction"

## Relationships

- The document uploader parses a file (officeparser for `.pdf`/`.docx`, native read
  for `.txt`) → chunks it → embeds chunks via the active embed model from
  `@acme/models` → upserts into `PgVector` with deterministic UUIDv5 ids.
- `PostgresStore` backs Mastra `Memory`; together they own thread/message/resource
  persistence in the app database.
- Mastra creates every `mastra_*` table at runtime; `@acme/rag/schema` exposes
  Drizzle mirrors of them so the data stays queryable.
- `assertThreadOwned` is the shared **thread ownership** rule: chat's ownership
  middleware and feedback's `submit` mutation both call it rather than re-reading
  `resourceId` inline.

## Decisions

See [`docs/adr/`](docs/adr/).
