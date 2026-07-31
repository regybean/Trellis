import { backendProject } from '@acme/test-utils/vitest';

// The async ingest pipeline tails a real per-user progress Redis Stream and (from
// ticket 3) indexes through @acme/rag into real Postgres/pgvector, so this suite
// runs against real testcontainers — mirroring chat. NEXT_PUBLIC_WEBAPP names the
// Postgres schema; a dedicated Redis logical DB keeps a parallel suite's flushDb
// from wiping ours. S3 and embeddings stay mocked in setup.ts. Infra descriptors
// are declared in ./src/tests/backend/global-setup.ts.
export default backendProject({
  webapp: 'ingest_test',
  redisDb: '4',
  globalSetup: './src/tests/backend/global-setup.ts',
  setupFiles: ['./src/tests/backend/setup.ts'],
});
