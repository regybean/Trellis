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

**Embedding purpose**:
Cohere's input-type distinction — `DOCUMENT_RETRIEVAL` when indexing, `TEXT_RETRIEVAL`
when querying — passed through `providerOptions.bedrock.embeddingPurpose`.
_Avoid_: "mode", "direction"

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
tables; the Drizzle mirrors (`documents`, `mastra_*`) exist only so the data is
queryable with Drizzle. Letting both own DDL would race and drift.

**Per-app separation via `schemaName`**: Mastra exposes no table-prefix hook, so
each app's tables live in a Postgres schema named after `NEXT_PUBLIC_WEBAPP`.

**Boundary**: the Mastra `Agent`/`Mastra` instance is _not_ here — the shared layer
cannot import features. This package exports primitives; `@acme/chat` assembles the
agent and the root `src/mastra` re-exports it for the Mastra CLI.
