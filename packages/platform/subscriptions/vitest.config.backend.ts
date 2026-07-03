import { redisContainer } from '@acme/redis/testing';
import { backendProject } from '@acme/test-utils/vitest';

// Credits storage is tested against a REAL Redis (see tests/service), so this
// suite needs a Redis container + an isolated logical Redis DB. The pure policy
// tests (tests/domain) run under the same config but touch nothing.
export default backendProject({
  webapp: 'subscriptions_test',
  redisDb: '5',
  infra: [redisContainer],
  include: ['src/tests/**/*.test.ts'],
});
