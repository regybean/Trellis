import { backendProject } from '@acme/test-utils/vitest';

// Pure provider-resolution tests: no Redis, no Postgres, no network. The ai-sdk
// factories only build config objects at import, so `staticTestEnv` (spread by
// backendProject) is enough to construct the ollama models — no globalSetup, so
// this is an infra-less suite (no testcontainers, no hydrate-env).
export default backendProject({
  webapp: 'models_test',
});
