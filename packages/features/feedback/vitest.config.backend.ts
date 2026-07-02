import { defineConfig, mergeConfig } from 'vitest/config';

import baseConfig from '@acme/vitest-config/base';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      name: 'backend',
      environment: 'node',
      // Per-suite isolation on the shared testcontainer DB/Redis (turbo runs
      // feature backend suites concurrently): a dedicated Postgres schema and a
      // dedicated Redis logical DB so a parallel suite's cleanup/flush can't wipe
      // ours. Consumed by env.ts + @acme/test-utils/hydrate-env.
      env: {
        NEXT_PUBLIC_WEBAPP: 'feedback_test',
        TEST_REDIS_DB: '3',
      },
      include: ['src/tests/backend/**/*.test.ts'],
      // hydrate-env runs first: copies testcontainer connection details into
      // process.env so every env.ts validates against the real DB/Redis.
      setupFiles: [
        '@acme/test-utils/hydrate-env',
        './src/tests/backend/setup.ts',
      ],
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
