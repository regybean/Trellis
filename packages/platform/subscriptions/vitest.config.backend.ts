import { backendProject } from '@acme/test-utils/vitest';

// Credits storage is tested against a REAL Redis (see tests/service), so this
// suite needs the shared testcontainer infra + an isolated logical Redis DB. The
// pure policy tests (tests/domain) run under the same config but touch nothing.
export default backendProject({
  webapp: 'subscriptions_test',
  redisDb: '5',
  include: ['src/tests/**/*.test.ts'],
});
