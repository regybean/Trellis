// App-owned Drizzle schema for the app database. drizzle-kit (push/generate)
// manages only what's exported here. `appSchema` is exported so drizzle owns the
// per-app Postgres schema's creation (CREATE SCHEMA).
//
// The Mastra Memory tables (`mastra_threads`, `mastra_messages`,
// `mastra_resources`) are intentionally NOT exported here: Mastra owns their DDL
// and creates them at runtime (@acme/rag ADR 0001), and the `!mastra_*` tablesFilter in
// drizzle.push.config.ts stops push from dropping them. They stay queryable via a
// direct import from `@acme/rag/schema` — a table doesn't need to be
// drizzle-kit-managed to be queried with drizzle-orm.
//
// App-owned tables go here, namespaced on `appSchema`.
export { appSchema } from '../app-schema';

// App-owned, drizzle-kit-managed tables from the chat feature. The slim subset
// drops auth/billing but keeps Conversation History; Folders and the
// per-Message Source receipt are scoped to the local principal's userId.
// Re-exported so push/generate own their DDL (@acme/rag ADR 0001).
export { chatFolder, messageDataSource } from '@acme/chat/schema';

// `data_source` — the user-owned partition of the knowledge base, scoped to the
// slim subset's local principal like Folders are. This is the one push-managed
// table from `@acme/rag`, whose other schema exports are Mastra-owned tables in
// the dedicated VECTOR database; naming this import rather than `export *` is
// what keeps push to the app database's table. Load-bearing for tests as well as
// production DDL: backend suites provision their tables by pushing an app's
// barrel, so a missed line fails nothing at build or lint and fails rag's suite
// at runtime with a bare `relation "data_source" does not exist`.
export { dataSource } from '@acme/rag/schema';
