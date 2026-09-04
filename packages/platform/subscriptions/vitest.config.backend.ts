import { backendProject } from '@acme/test-utils/vitest';

// Credits storage is tested against a REAL Redis (see
// tests/backend/integration/service), so this suite needs a Redis container +
// an isolated logical Redis DB. The pure policy tests (tests/backend/unit) run
// under the same config but touch nothing. Infra descriptors are declared in
// ./src/tests/backend/global-setup.ts.
export default backendProject({
  webapp: 'subscriptions_test',
  redisDb: '5',
  globalSetup: './src/tests/backend/global-setup.ts',
});
