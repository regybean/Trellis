import { defineConfig, mergeConfig } from 'vitest/config';

import baseConfig from '@acme/vitest-config/base';

// No `globalSetup`: the scheduler is a function over a stage list and the
// reporter is a function over its results, so the suite needs no infra at all.
// The one suite that spawns anything spawns `node -e`, which needs nothing
// either.
export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      name: 'backend',
      environment: 'node',
      include: ['src/tests/backend/**/*.test.ts'],
    },
  }),
);
