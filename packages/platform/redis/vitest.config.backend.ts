import { defineConfig, mergeConfig } from 'vitest/config';

import baseConfig from '@acme/vitest-config/base';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      name: 'redis',
      environment: 'node',
      include: ['src/tests/**/*.test.ts'],
    },
  }),
);
