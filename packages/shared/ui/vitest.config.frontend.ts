import react from '@vitejs/plugin-react';
import { defineConfig, mergeConfig } from 'vitest/config';

import { staticTestEnv } from '@acme/test-utils/vitest';
import baseConfig from '@acme/vitest-config/base';

export default mergeConfig(
  baseConfig,
  defineConfig({
    plugins: [react()],
    test: {
      name: 'frontend',
      environment: 'jsdom',
      // `@acme/ui` owns no env.ts, but the spread is the shared frontend
      // contract: any module reachable from a test validates against these
      // real values rather than a mock (ADR 0014).
      env: { ...staticTestEnv },
      include: ['src/tests/frontend/**/*.test.tsx'],
      setupFiles: ['./src/tests/frontend/setup.ts'],
    },
  }),
);
