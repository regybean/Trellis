/* eslint-disable no-restricted-properties */
import { pgSchema } from 'drizzle-orm/pg-core';

// The per-app Postgres schema, app-owned. Exported through the app DB's
// drizzle-kit entrypoint (db/schema.ts) so drizzle emits `CREATE SCHEMA` and owns
// its creation in the app database. The vector database is fully Mastra-owned —
// drizzle-kit doesn't manage it (ADR-0002) — so Mastra creates the same-named
// schema there itself via `CREATE SCHEMA IF NOT EXISTS` at runtime. Run drizzle
// first on a fresh app DB (db:push / db:migrate before booting the app).
// See ADR-0002.
//
// Name matches the `schemaFilter` fallback in the drizzle configs so push,
// generate, and the schema object all resolve to the same Postgres schema.
export const appSchema = pgSchema(
  process.env.NEXT_PUBLIC_WEBAPP ?? 'tanstack-slim',
);
