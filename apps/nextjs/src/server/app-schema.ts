/* eslint-disable no-restricted-properties */
import { pgSchema } from 'drizzle-orm/pg-core';

// The per-app Postgres schema, app-owned. Exported through the drizzle-kit
// entrypoints (db/schema.ts, vdb/schema.ts) so drizzle emits `CREATE SCHEMA` and
// owns its creation. Mastra independently issues `CREATE SCHEMA IF NOT EXISTS`
// for the same name at runtime (its own `pgSchema` in @acme/rag) — idempotent, so
// it's a harmless no-op once drizzle has created the schema. Run drizzle first on
// a fresh DB (db:push / db:migrate before booting the app). See ADR-0002.
//
// Name matches the `schemaFilter` fallback in the drizzle configs so push,
// generate, and the schema object all resolve to the same Postgres schema.
export const appSchema = pgSchema(process.env.NEXT_PUBLIC_WEBAPP ?? 'nextjs');
