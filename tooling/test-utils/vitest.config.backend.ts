import { defineConfig, mergeConfig } from 'vitest/config';

import baseConfig from '@acme/vitest-config/base';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      name: 'backend',
      environment: 'node',
      include: ['src/tests/backend/**/*.test.ts'],
      // No globalSetup: these suites drive scripts and git sandboxes, not
      // containers. The one that needed LocalStack moved to @acme/secrets-sync,
      // and took the descriptor with it.
      testTimeout: 120000,
      hookTimeout: 120000,
      pool: 'forks',
      maxWorkers: 1,
      isolate: false,
    },
  }),
);
