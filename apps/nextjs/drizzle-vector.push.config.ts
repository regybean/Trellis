import type { Config } from 'drizzle-kit';

import base from './drizzle-vector.config';

// `db:push`-only config for the vector database. The knowledge-base table is
// Mastra-owned (PgVector creates it) and named `mastra_documents`, so the same
// `!mastra_*` blacklist that protects the memory tables also protects it — push
// only manages app-owned tables. See drizzle.push.config.ts and ADR-0002.
export default {
  ...base,
  tablesFilter: ['!mastra_*'],
} satisfies Config;
