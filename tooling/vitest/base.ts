import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    env: {
      NODE_ENV: 'test',
      SKIP_ENV_VALIDATION: 'true',
    },
    mockReset: true,
    testTimeout: 30000,
    hookTimeout: 30000,
    reporters: ['verbose'],
    passWithNoTests: true,
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'json', 'html'],
    },
  },
});
