import { backendProject } from '@acme/test-utils/vitest';

// Pure schema/profile-resolution tests: no Redis, no Postgres, no network, so
// no globalSetup (infra-less — no testcontainers, no hydrate-env). `webapp` is
// only the `staticTestEnv` spread's neutral default here; nothing in this suite
// reads it.
export default backendProject({
  webapp: 'env_test',
});
