import { defineConfig, mergeConfig } from 'vitest/config';

import { staticTestEnv } from '@acme/test-utils/vitest';
import baseConfig from '@acme/vitest-config/base';

// Ingest's router touches neither the feature DB nor Redis — its only external
// dependencies are the document store (@acme/rag/server) and S3, both of
// which are mocked in setup.ts. So, unlike billing/chat, there is no container
// global-setup here: these tests run anywhere with no infra. Env is still real
// (validated by env.ts): staticTestEnv satisfies ingest's AWS/S3 vars and the
// @acme/redis/env (a valid REDIS_URL) that @acme/trpc constructs at import.
export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      name: 'backend',
      environment: 'node',
      env: { ...staticTestEnv },
      include: ['src/tests/backend/**/*.test.ts'],
      setupFiles: ['./src/tests/backend/setup.ts'],
    },
  }),
);
