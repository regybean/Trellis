import { backendProject } from '@acme/test-utils/vitest';

// A pure classifier over captured error shapes: no Redis, no Postgres, no
// network, no provider SDK. Nothing here reads env either — `backendProject`
// supplies `staticTestEnv` anyway, and there is no globalSetup, so this is an
// infra-less suite (no testcontainers, no hydrate-env).
export default backendProject({
  webapp: 'provider_errors_test',
});
