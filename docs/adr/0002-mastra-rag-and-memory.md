# Mastra owns RAG + Memory; Drizzle mirrors are marked-applied read models

RAG and conversation persistence run on Mastra (`@mastra/core`, `@mastra/rag`,
`@mastra/pg`, `@mastra/memory`), wrapped by a new shared package `@acme/rag`.
`@acme/llamaindex` is left intact but is no longer wired into any feature. Three
decisions are load-bearing:

1. **Mastra owns the DDL; Drizzle tables are mirrors marked applied.** Mastra's
   `PgVector` and `PostgresStore` create their tables at runtime. `@acme/rag/schema`
   declares Drizzle mirrors (`documents`, `mastra_threads`, `mastra_messages`,
   `mastra_resources`) so the data stays queryable with Drizzle, and we generate the
   matching migrations — but the operator **marks them applied** rather than running
   them, because Mastra has already created the tables.
2. **Per-app isolation via a Postgres schema, not a table prefix.** Mastra has no
   table-prefix option, so both stores set `schemaName: NEXT_PUBLIC_WEBAPP`. Each app
   gets its own schema (auto `CREATE SCHEMA IF NOT EXISTS`), and the Drizzle mirrors
   use `pgSchema(NEXT_PUBLIC_WEBAPP)` to match.
3. **Bedrock via an AI-SDK provider instance, not Mastra's model router.** Mastra's
   model router has no native Bedrock entry, so we pass an `@ai-sdk/amazon-bedrock`
   provider instance directly as the agent/embedding model (Claude chat + Cohere
   `embed-english-v3`, with `embeddingPurpose` distinguishing document vs. query).

## Status

accepted

## Considered and rejected

- **Let Drizzle own the DDL (run the migrations).** Drizzle and Mastra would race to
  create the same tables and could drift on column types Mastra controls. Rejected —
  one owner; Mastra is it. The mirrors exist only so Drizzle can *read*.
- **A literal `acme_`-style table prefix for multi-app separation.** Mastra exposes
  no prefix hook; faking it would mean post-processing DDL we don't own. The
  `schemaName` option is the supported, first-class mechanism. Rejected.
- **Overwrite/replace `@acme/llamaindex` in place.** Keeping it intact lets the two
  implementations coexist during cutover and preserves a working reference. Rejected
  the rename.
- **Mastra Memory's native vector/semantic recall for chat history.** Not needed —
  last-N message recall suffices; the knowledge base is the only vector store.

## Consequences

- New package `@acme/rag` (shared layer) exports Bedrock providers, the `PgVector`
  store, `PostgresStore`, Mastra `Memory`, and the officeparser-based document
  uploader. The Mastra `Agent`/`Mastra` instance lives in `@acme/chat` (the shared
  layer cannot import features). The root `pnpm studio` / `pnpm lint:mastra`
  scripts point the Mastra CLI's `--dir` straight at `packages/features/chat/src/mastra`
  rather than re-exporting through a root package — declaring a workspace dependency
  on a feature at the root would pull the root package into the turbo boundary graph.
- The generated migrations bake `NEXT_PUBLIC_WEBAPP` (default `acme`) into the SQL
  schema name; an app on a different schema regenerates with its own value.
- Document parsing is now local (`officeparser`: `.pdf`/`.docx`, native read for
  `.txt`; legacy `.doc` dropped) — no LlamaParse/LlamaCloud dependency.
- Fresh start: old `acme_documents` vector data and `chats`/`messages` history are
  not migrated.
