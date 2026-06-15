import type { Config } from 'drizzle-kit';

import base from './drizzle-vector.config';

// `db:push`-only config for the vector database. The knowledge-base table is
// Mastra-owned (PgVector creates it at runtime) and named `mastra_documents`, so
// the same `!mastra_*` filter that protects the memory tables protects it: it
// hides Mastra's table during introspection so push won't DROP it. push manages
// app-owned tables only. See drizzle.push.config.ts and ADR-0002.
export default {
  ...base,
  tablesFilter: ['!mastra_*'],
} satisfies Config;
