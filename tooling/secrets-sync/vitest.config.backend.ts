import { defineConfig, mergeConfig } from 'vitest/config';

import baseConfig from '@acme/vitest-config/base';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      name: 'backend',
      environment: 'node',
      include: ['src/tests/backend/**/*.test.ts'],
      // LocalStack for the round-trip test. The unit tests need nothing, but
      // one container for the package is cheaper than a second vitest project
      // to keep them apart.
      globalSetup: ['./src/tests/backend/global-setup.ts'],
      // The round-trip test drives the shell scripts, which launch tsx and the
      // aws CLI several times each. Cheap alone, but the gate runs every
      // package's suite at once and these are the tests that feel it.
      testTimeout: 180000,
      hookTimeout: 180000,
      pool: 'forks',
      maxWorkers: 1,
      isolate: false,
    },
  }),
);
