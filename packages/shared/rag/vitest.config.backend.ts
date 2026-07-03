import { postgresContainer } from '@acme/db/testing';
import { backendProject } from '@acme/test-utils/vitest';

// NEXT_PUBLIC_WEBAPP names the Postgres/pgvector schema (kept as `nextjs`, where
// the Mastra Memory + knowledge-base tables are provisioned). No Redis here.
export default backendProject({
  webapp: 'nextjs',
  infra: [postgresContainer],
  setupFiles: ['./src/tests/backend/setup.ts'],
});
