import { defineConfig, mergeConfig } from 'vitest/config';

import { backendProject } from '@acme/test-utils/vitest';

// NEXT_PUBLIC_WEBAPP only drives the @acme/redis key namespace here (billing's
// own env has no webapp; its DB tables aren't schema-scoped by it), so any valid
// identifier works — `billing_test` doubles as Redis-prefix isolation alongside
// the dedicated logical DB. mockReset stays off: this suite relies on mock
// implementations persisting across tests (see setup.ts).
export default mergeConfig(
  backendProject({
    webapp: 'billing_test',
    redisDb: '1',
    setupFiles: ['./src/tests/backend/setup.ts'],
  }),
  defineConfig({ test: { mockReset: false } }),
);
