# Mastra owns RAG + Memory; Drizzle mirrors are query-only read models

RAG and conversation persistence run on Mastra (`@mastra/core`, `@mastra/rag`,
`@mastra/pg`, `@mastra/memory`), wrapped by a new shared package `@acme/rag`.
`@acme/llamaindex` is left intact but is no longer wired into any feature. Three
decisions are load-bearing:

1. **Mastra owns the DDL; Drizzle mirrors are query-only and unmanaged by
   drizzle-kit.** Mastra's `PgVector` and `PostgresStore` create their tables at
   runtime. `@acme/rag/schema` declares Drizzle mirrors (`mastra_documents`,
   `mastra_threads`, `mastra_messages`, `mastra_resources`) so the data stays
   queryable with Drizzle — but these mirrors are **not** exported through the
   drizzle-kit schema entrypoints, so `db:push`/`db:generate` neither create, alter,
   nor track them. (A table only needs its TypeScript definition to be queried with
   drizzle-orm; it does not need to be drizzle-kit-managed. This replaces the earlier
   "generate the migrations but mark them applied" approach — there are no mirror
   migrations to mark.) The **app database** `db:push` additionally carries a
   `!mastra_*` `tablesFilter` whose real job is to hide Mastra's runtime tables
   (`mastra_threads`, `mastra_messages`, `mastra_resources`) during DB introspection
   so push doesn't try to DROP tables it doesn't declare; `tablesFilter` does not
   affect the code-derived desired state. **Invariant: every Mastra-owned table is
   `mastra_`-prefixed** — including the knowledge-base table, named `mastra_documents`
   for exactly this reason (its name is ours; PgVector owns its DDL). Everything else
   in the per-app schema is app-owned.

   **Amendment (vector DB no longer drizzle-kit-managed).** The vector database has
   no app-owned tables — only Mastra's `mastra_documents` — so drizzle-kit doesn't
   manage it at all: there is no vector `db:push`/`db:generate`/`db:migrate`, and the
   vector drizzle configs and `vdb/schema.ts` entrypoint were removed. The query-only
   mirror in `@acme/rag/schema` still backs Drizzle reads/deletes against the
   knowledge base. Reason: `mastra_documents` has a `serial` id whose backing
   sequence (`mastra_documents_id_seq`) is **not** covered by `tablesFilter` (a known
   drizzle-kit limitation — sequences aren't filtered with their table), so vector
   `db:push` tried to `DROP SEQUENCE` it and failed on the column dependency. Mastra
   owns the whole vector DB end to end, including its schema creation.
2. **Per-app isolation via a Postgres schema, not a table prefix.** Mastra has no
   table-prefix option, so both stores set `schemaName: NEXT_PUBLIC_WEBAPP`. Each app
   gets its own schema. **Drizzle owns the app database's schema creation:** the app
   exports an `appSchema = pgSchema(NEXT_PUBLIC_WEBAPP)`
   (`apps/nextjs/src/server/app-schema.ts`) through the app DB drizzle-kit entrypoint
   so `CREATE SCHEMA` is emitted. Mastra also issues `CREATE SCHEMA IF NOT EXISTS`
   for the same name at runtime — idempotent, so a harmless no-op once drizzle
   created it. **Run drizzle before the app on a fresh app DB** (`db:push` in dev,
   `db:migrate` in deploy, both before boot). drizzle-kit emits plain `CREATE SCHEMA`
   (no `IF NOT EXISTS`) in generated migrations, so the first migration's
   schema-creation line should be hand-edited to `CREATE SCHEMA IF NOT EXISTS` to
   stay safe if Mastra ever boots first. App-owned tables are namespaced on
   `appSchema`. For the **vector database** (no app-owned tables; see the amendment
   to point 1) Mastra owns schema creation outright via its runtime
   `CREATE SCHEMA IF NOT EXISTS`.
3. **Bedrock via an AI-SDK provider instance, not Mastra's model router.** Mastra's
   model router has no native Bedrock entry, so we pass an `@ai-sdk/amazon-bedrock`
   provider instance directly as the agent/embedding model (Claude chat + Cohere
   `embed-english-v3`, with `inputType` — `search_document` vs. `search_query` —
   distinguishing document from query embeddings).
   **Superseded by [ADR 0003](./0003-multi-provider-models.md):** the AI-SDK-instance
   approach stands, but the instance is now resolved by `@acme/models` (one of
   Bedrock / OpenRouter / Ollama, Ollama default) rather than constructed in
   `@acme/rag`. Bedrock is no longer the only — or default — provider.

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
  layer cannot import features). The `studio` / `lint:mastra` scripts live in
  `@acme/chat` and run the Mastra CLI against `src/mastra`; the root `pnpm studio` /
  `pnpm lint:mastra` delegate via `pnpm --filter @acme/chat` (studio wrapped in
  `with-env` to load `.env`). Keeping the scripts in the feature avoids declaring a
  workspace dependency on a feature at the root, which would pull the root package
  into the turbo boundary graph.
- The generated migrations bake `NEXT_PUBLIC_WEBAPP` (default `nextjs`) into the SQL
  schema name; an app on a different schema regenerates with its own value.
- Document parsing is now local (`officeparser`: `.pdf`/`.docx`, native read for
  `.txt`; legacy `.doc` dropped) — no LlamaParse/LlamaCloud dependency.
- Fresh start: old `acme_documents` vector data and `chats`/`messages` history are
  not migrated.
