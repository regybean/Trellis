import { defineConfig, mergeConfig } from 'vitest/config';

import baseConfig from '@acme/vitest-config/base';

// No `globalSetup`: the tool reads manifests and spawns vitest, so its suite
// needs no infra at all (ADR 0017 — a suite declares the infra it uses, and
// declaring none is the honest answer here).
//
// The service tests each collect a whole workspace — a sandbox in one case, this
// repo in the other — which is minutes of nested vitest, so the timeouts are the
// generous ones a real-infra suite uses.
export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      name: 'backend',
      environment: 'node',
      include: ['src/tests/backend/**/*.test.ts'],
      testTimeout: 900_000,
      hookTimeout: 900_000,
      pool: 'forks',
      maxWorkers: 1,
      isolate: false,
    },
  }),
);
