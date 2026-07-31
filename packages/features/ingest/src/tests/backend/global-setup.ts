import { postgresContainer } from '@acme/db/testing';
import { redisContainer } from '@acme/redis/testing';
import { runInfraSetup } from '@acme/test-utils/setup';

// The async ingest pipeline tails a real per-user progress Redis Stream, and the
// worker path (ticket 3) indexes into a real Postgres/pgvector via @acme/rag. This
// suite provisions both; S3 and embeddings stay mocked in setup.ts.
export default runInfraSetup([postgresContainer, redisContainer]);
