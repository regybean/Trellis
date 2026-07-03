import { backendProject } from '@acme/test-utils/vitest';

// Ingest's router touches neither the feature DB nor Redis — its only external
// dependencies are the document store (@acme/rag/server) and S3, both mocked in
// setup.ts. So this suite runs with `infra: false`: no testcontainer
// global-setup, no env hydration. Env is still real (validated by env.ts):
// staticTestEnv satisfies ingest's AWS/S3 vars and the @acme/redis/env (a valid
// REDIS_URL) that @acme/trpc constructs at import.
export default backendProject({
  webapp: 'ingest_test',
  infra: [],
  setupFiles: ['./src/tests/backend/setup.ts'],
});
