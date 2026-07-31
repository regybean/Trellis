import { backendProject } from '@acme/test-utils/vitest';

// Real Redis via testcontainers: `publish` and `tailNotifications` are exercised
// against a live per-user stream (no mocks — the whole point is the round-trip
// through Redis). A dedicated logical Redis DB isolates this suite's flushDb from
// parallel suites; the infra descriptor is declared in
// ./src/tests/backend/global-setup.ts.
export default backendProject({
  webapp: 'testing',
  redisDb: '5',
  globalSetup: './src/tests/backend/global-setup.ts',
  setupFiles: ['./src/tests/backend/setup.ts'],
});
