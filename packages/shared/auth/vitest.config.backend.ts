import { backendProject } from '@acme/test-utils/vitest';

// `webapp` names the per-app Postgres schema the global push provisions (ADR
// 0021) — this suite doesn't use it, but the push needs a target and the value
// keeps the suite off any other schema. The tables under test live in the fixed
// `auth` schema, which the same push creates because the canonical app
// re-exports them and lists `auth` in its `schemaFilter` (ADR 0034). No Redis.
export default backendProject({
  webapp: 'auth_test',
  globalSetup: './src/tests/backend/global-setup.ts',
  setupFiles: ['./src/tests/backend/setup.ts'],
});
