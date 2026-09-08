import { defineConfig, mergeConfig } from 'vitest/config';

import baseConfig from '@acme/vitest-config/base';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      name: 'backend',
      environment: 'node',
      include: ['src/tests/backend/**/*.test.ts'],
      // No `globalSetup`. The bank talks to git and the filesystem and to
      // nothing else, so these suites start no container — which is half the
      // point of the package: they used to wait on LocalStack coming up for a
      // sibling suite that had nothing to do with them.
      testTimeout: 120000,
      hookTimeout: 120000,
      pool: 'forks',
      maxWorkers: 1,
      isolate: false,
    },
  }),
);
