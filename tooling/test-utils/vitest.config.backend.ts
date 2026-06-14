import { defineConfig, mergeConfig } from 'vitest/config';

import baseConfig from '@acme/vitest-config/base';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      name: 'backend',
      environment: 'node',
      include: ['src/tests/backend/**/*.test.ts'],
      globalSetup: ['./src/tests/backend/global-setup.ts'],
      testTimeout: 120000,
      hookTimeout: 120000,
      pool: 'forks',
      maxWorkers: 1,
      isolate: false,
    },
  }),
);
