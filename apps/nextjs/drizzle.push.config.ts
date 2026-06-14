import type { Config } from 'drizzle-kit';

import base from './drizzle.config';

// `db:push`-only config. Mastra owns the DDL for every `mastra_`-prefixed table
// (see ADR-0002); push force-reconciles the DB to the Drizzle schema, so letting
// it see those tables means it tries to drop/alter them. Blacklisting `mastra_*`
// scopes push to app-owned tables only — it physically cannot touch Mastra's.
// `db:generate` keeps the full schema (base config) for the marked-applied mirrors.
export default {
  ...base,
  tablesFilter: ['!mastra_*'],
} satisfies Config;
