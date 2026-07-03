import { backendProject } from '@acme/test-utils/vitest';

// Per-suite isolation on the shared testcontainer DB/Redis (turbo runs feature
// backend suites concurrently): a dedicated Postgres schema (NEXT_PUBLIC_WEBAPP)
// and a dedicated Redis logical DB so a parallel suite's cleanup/flush can't
// wipe ours. Infra descriptors are declared in ./src/tests/backend/global-setup.ts.
export default backendProject({
  webapp: 'feedback_test',
  redisDb: '3',
  globalSetup: './src/tests/backend/global-setup.ts',
  setupFiles: ['./src/tests/backend/setup.ts'],
});
