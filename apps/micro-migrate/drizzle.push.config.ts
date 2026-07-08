import type { Config } from 'drizzle-kit';

import base from './drizzle.config';

// `db:push`-only config. Mastra owns the DDL for every `mastra_`-prefixed table
// (ADR 0002) and creates them at runtime; `tablesFilter: ['!mastra_*']` hides
// them during introspection so push never tries to DROP them. strict/verbose off
// so `--force` runs fully non-interactive (the migrate container is headless).
export default {
  ...base,
  tablesFilter: ['!mastra_*'],
  strict: false,
  verbose: false,
} satisfies Config;
