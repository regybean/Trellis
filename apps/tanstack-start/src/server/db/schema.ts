// App-owned Drizzle schema for the app database. drizzle-kit (push/generate)
// manages only what's exported here. `appSchema` is exported so drizzle owns the
// per-app Postgres schema's creation (CREATE SCHEMA).
//
// The Mastra Memory tables (`mastra_threads`, `mastra_messages`,
// `mastra_resources`) are intentionally NOT exported here: Mastra owns their DDL
// and creates them at runtime (ADR-0002), and the `!mastra_*` tablesFilter in
// drizzle.push.config.ts stops push from dropping them. They stay queryable via a
// direct import from `@acme/rag/schema` — a table doesn't need to be
// drizzle-kit-managed to be queried with drizzle-orm.
//
// App-owned tables go here, namespaced on `appSchema`.
export { appSchema } from '../app-schema';

// App-owned, drizzle-kit-managed tables. Re-exported from their feature packages
// so push/generate own their DDL (the feature defines the columns; the app
// decides to manage them). They carry Mastra-owned ids by value with no FK — see
// the feature schema notes and ADR-0002.
export { feedbackRating, messageFeedback } from '@acme/feedback/schema';
export { chatFolder } from '@acme/chat/schema';
