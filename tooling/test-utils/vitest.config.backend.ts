import { defineConfig, mergeConfig } from 'vitest/config';

import baseConfig from '@acme/vitest-config/base';

// No `globalSetup`: this suite drives the engine with descriptor sets that start
// nothing, so it needs no infra at all — a suite declares the infra it uses, and
// declaring none is the honest answer here. It is also the point: the thing
// every other backend suite depends on has to be reachable without the
// containers it exists to start.
//
// `backendProject` is deliberately not used. It is this package's own export, so
// configuring the suite with it would make a change to the preset able to hide a
// change to the engine.
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
