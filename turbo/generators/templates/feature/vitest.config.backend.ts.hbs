import { defineConfig, mergeConfig } from 'vitest/config';

import baseConfig from '@acme/vitest-config/base';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      name: 'backend',
      environment: 'node',
      include: ['src/tests/backend/**/*.test.ts'],
      setupFiles: ['./src/tests/backend/setup.ts'],
      // Starts/stops the PostgreSQL + Redis testcontainers (needs Docker).
      globalSetup: ['./src/tests/backend/global-setup.ts'],
      // Real DB means generous timeouts and a single, non-isolated worker so
      // tests share one connection/transaction space deterministically.
      testTimeout: 60_000,
      hookTimeout: 60_000,
      pool: 'forks',
      maxWorkers: 1,
      isolate: false,
    },
  }),
);
