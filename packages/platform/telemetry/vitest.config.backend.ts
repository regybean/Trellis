import { backendProject } from '@acme/test-utils/vitest';

// Pure config/guard tests: no collector, no Postgres, no Redis, no network, so
// no globalSetup (infra-less — no testcontainers, no hydrate-env). The suite
// never starts the SDK, which is the point of it: the whole defect being fixed
// is a span processor that exists when it should not, so a test that builds one
// would be reproducing the bug to check for it. `webapp` is only the
// `staticTestEnv` spread's neutral default here; nothing in this suite reads it.
export default backendProject({
  webapp: 'telemetry_test',
});
