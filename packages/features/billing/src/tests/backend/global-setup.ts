import { postgresContainer } from '@acme/db/testing';
import { redisContainer } from '@acme/redis/testing';
import { runInfraSetup } from '@acme/test-utils/setup';

// This suite touches a real Postgres (billing tables) and Redis (rate limits).
export default runInfraSetup([postgresContainer, redisContainer]);
