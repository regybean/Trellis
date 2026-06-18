import type { Config } from 'drizzle-kit';

import base from './drizzle.config';

// `db:push`-only config. Mastra owns the DDL for every `mastra_`-prefixed table
// (see ADR-0002) and creates them at runtime; the Drizzle schema doesn't declare
// them. tablesFilter applies only to the tables push reads FROM the database (the
// current state) — not to the code-derived desired state — so its job here is to
// hide Mastra's runtime tables during introspection. Without `!mastra_*`, push
// would see those tables, find them absent from the code schema, and try to DROP
// them. With it, push leaves Mastra's tables untouched and manages app-owned
// tables only. (It does NOT, and cannot, stop push from CREATEing tables you
// declare in code — keep Mastra tables out of the schema for that.)
export default {
  ...base,
  tablesFilter: ['!mastra_*'],
} satisfies Config;
