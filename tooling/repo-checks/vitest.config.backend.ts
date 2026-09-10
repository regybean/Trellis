import { defineConfig, mergeConfig } from 'vitest/config';

import baseConfig from '@acme/vitest-config/base';

// No `globalSetup`: these rules read manifests, text and `git ls-files`, so the
// suite needs no infra at all — a suite declares the infra it uses, and
// declaring none is the honest answer here.
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
