import { postgresContainer } from '@acme/db/testing';
import { redisContainer } from '@acme/redis/testing';
import { runInfraSetup } from '@acme/test-utils/setup';

import { localstripeContainer } from '../../testing';

// This suite touches a real Postgres (billing tables), Redis (rate limits) and
// a real Stripe server — localstripe, declared through the same descriptor
// mechanism as the other two, so `pnpm turbo run test -F @acme/billing` needs a
// container runtime and nothing else (no `pnpm infra:up`). The products and
// plans inside it are seeded per test file, because localstripe holds them in
// memory.
export default runInfraSetup([
  postgresContainer,
  redisContainer,
  localstripeContainer,
]);
