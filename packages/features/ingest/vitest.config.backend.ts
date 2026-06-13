import { defineConfig, mergeConfig } from 'vitest/config';

import baseConfig from '@acme/vitest-config/base';

// Ingest's router touches neither the feature DB nor Redis — its only external
// dependencies are the document store (@acme/llamaindex/server) and S3, both of
// which are mocked in setup.ts. So, unlike billing/chat, there is no container
// global-setup here: these tests run anywhere with no infra.
export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      name: 'backend',
      environment: 'node',
      include: ['src/tests/backend/**/*.test.ts'],
      setupFiles: ['./src/tests/backend/setup.ts'],
    },
  }),
);
