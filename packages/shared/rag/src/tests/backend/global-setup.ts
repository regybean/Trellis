import { postgresContainer } from '@acme/db/testing';
import { runInfraSetup } from '@acme/test-utils/setup';

// This suite touches a real Postgres/pgvector (Mastra Memory + knowledge base);
// no Redis.
export default runInfraSetup([postgresContainer]);
