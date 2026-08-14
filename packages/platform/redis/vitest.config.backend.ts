import { backendProject } from '@acme/test-utils/vitest';

// The durable-stream primitive is exercised against a REAL Redis (see
// src/tests/integration) — write/lastId/read/tail round-trips through a live
// stream, no mocks. A dedicated logical Redis DB isolates this suite's flushDb
// from parallel suites; the infra descriptor is declared in
// ./src/tests/global-setup.ts. The pure key-namespace / config unit tests run
// under the same config but touch no container.
export default backendProject({
  webapp: 'redis_test',
  redisDb: '6',
  globalSetup: './src/tests/global-setup.ts',
  include: ['src/tests/**/*.test.ts'],
});
