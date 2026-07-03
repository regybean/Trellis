import { postgresContainer } from '@acme/db/testing';
import { redisContainer } from '@acme/redis/testing';
import { backendProject } from '@acme/test-utils/vitest';

// Per-suite isolation on the shared testcontainer DB/Redis: NEXT_PUBLIC_WEBAPP
// names the Postgres schema Mastra Memory lives in (kept as `nextjs`, where the
// mastra_* tables are provisioned), plus a dedicated Redis logical DB so a
// parallel suite's flushDb can't wipe ours.
export default backendProject({
  webapp: 'nextjs',
  redisDb: '2',
  infra: [postgresContainer, redisContainer],
  setupFiles: ['./src/tests/backend/setup.ts'],
});
