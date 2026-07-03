import { backendProject } from '@acme/test-utils/vitest';

// Credits storage is tested against a REAL Redis (see tests/integration/service),
// so this suite needs a Redis container + an isolated logical Redis DB. The pure
// policy tests (tests/unit) run under the same config but touch nothing. Infra
// descriptors are declared in ./src/tests/global-setup.ts.
export default backendProject({
  webapp: 'subscriptions_test',
  redisDb: '5',
  globalSetup: './src/tests/global-setup.ts',
  include: ['src/tests/**/*.test.ts'],
});
