import { redisContainer } from '@acme/redis/testing';
import { runInfraSetup } from '@acme/test-utils/setup';

// Credits storage is tested against a real Redis (tests/integration/service); no Postgres.
export default runInfraSetup([redisContainer]);
