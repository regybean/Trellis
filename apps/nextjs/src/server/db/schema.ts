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

// App-owned, drizzle-kit-managed tables. Re-exported from their feature packages
// so push/generate own their DDL (the feature defines the columns; the app
// decides to manage them). They carry Mastra-owned ids by value with no FK — see
// the feature schema notes and @acme/rag ADR 0001.
export { messageFeedback, feedbackRating } from '@acme/feedback/schema';
export { chatFolder, messageDataSource } from '@acme/chat/schema';

// `data_source` — the user-owned partition of the knowledge base. This is the
// one push-managed table from `@acme/rag`, whose other schema exports are
// Mastra-owned tables in the dedicated VECTOR database; naming this import
// rather than `export *` is what keeps push to the app database's table.
// Load-bearing for tests as well as production DDL: backend suites provision
// their tables by pushing this barrel, so a missed line here fails nothing at
// build or lint and fails rag's suite at runtime with a bare
// `relation "data_source" does not exist`.
export { dataSource } from '@acme/rag/schema';

// Better Auth's tables, in their own `auth` Postgres schema rather than
// `appSchema` — identity is shared across the apps on one database (@acme/auth ADR 0002).
// `authSchema` is exported so drizzle owns `CREATE SCHEMA auth`, and `auth` is
// listed in the drizzle configs' `schemaFilter` so push manages them at all.
export {
  authSchema,
  authUser,
  authSession,
  authAccount,
  authVerification,
} from '@acme/auth/schema';
