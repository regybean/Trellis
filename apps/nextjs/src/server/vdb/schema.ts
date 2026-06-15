// App-owned Drizzle schema for the vector database. Same ownership model as
// db/schema.ts: `appSchema` is exported so drizzle owns the per-app Postgres
// schema's creation (CREATE SCHEMA).
//
// The knowledge-base table (`mastra_documents`) is Mastra-owned — PgVector
// creates it at runtime (ADR-0002) — so it's NOT exported here, and the
// `!mastra_*` tablesFilter in drizzle-vector.push.config.ts stops push from
// dropping it. It stays queryable via `@acme/rag/schema`.
//
// App-owned vector tables go here, namespaced on `appSchema`.
export { appSchema } from '../app-schema';
