import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // Only NODE_ENV is universal here. Static, non-secret domain env lives in
    // `staticTestEnv` (@acme/test-utils/vitest), spread per-package so this base
    // config stays domain-free; dynamic DB/Redis details are hydrated per-run by
    // `@acme/test-utils/hydrate-env`.
    env: {
      NODE_ENV: 'test',
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
