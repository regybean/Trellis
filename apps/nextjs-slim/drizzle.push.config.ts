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
// strict/verbose off so `db:push --force` skips the data-loss confirmations (used
// by `pnpm dev`). push is dev-only; dev accepts data loss. Note this is NOT fully
// non-interactive: a renamed column still triggers drizzle-kit's "created or
// renamed from another column?" prompt, which no flag suppresses — `scripts/dev.sh`
// closes stdin so that aborts loudly rather than hanging. Manual prod schema
// changes go through generate + migrate, not push.
export default {
  ...base,
  tablesFilter: ['!mastra_*'],
  strict: false,
  verbose: false,
} satisfies Config;
