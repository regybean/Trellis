import react from '@vitejs/plugin-react';
import { defineConfig, mergeConfig } from 'vitest/config';

import baseConfig from '@acme/vitest-config/base';

export default mergeConfig(
  baseConfig,
  defineConfig({
    plugins: [react()],
    test: {
      name: 'frontend',
      environment: 'jsdom',
      include: ['src/tests/frontend/**/*.test.{ts,tsx}'],
      setupFiles: ['./src/tests/frontend/setup.ts'],
    },
  }),
);
