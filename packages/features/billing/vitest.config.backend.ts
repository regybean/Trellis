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
      globalSetup: ['./src/tests/backend/global-setup.ts'],
      testTimeout: 60000,
      hookTimeout: 60000,
      pool: 'forks',
      maxWorkers: 1,
      isolate: false,
      mockReset: false,
    },
  }),
);
