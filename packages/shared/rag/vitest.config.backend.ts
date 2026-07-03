import { backendProject } from '@acme/test-utils/vitest';

// NEXT_PUBLIC_WEBAPP names the Postgres/pgvector schema (kept as `nextjs`, where
// the Mastra Memory + knowledge-base tables are provisioned). No Redis here.
// Infra descriptors are declared in ./src/tests/backend/global-setup.ts.
export default backendProject({
  webapp: 'nextjs',
  globalSetup: './src/tests/backend/global-setup.ts',
  setupFiles: ['./src/tests/backend/setup.ts'],
});
