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
      // jsdom = client mode: env.ts validates client + shared vars against these
      // real values instead of a mocked ../../env.
      env: { ...staticTestEnv },
      include: ['src/tests/frontend/**/*.test.tsx'],
      setupFiles: ['./src/tests/frontend/setup.tsx'],
    },
  }),
);
