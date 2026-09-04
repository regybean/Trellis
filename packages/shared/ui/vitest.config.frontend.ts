import { frontendProject } from '@acme/test-utils/vitest';

// `@acme/ui` owns no env.ts, but `frontendProject`'s `staticTestEnv` spread is
// the shared frontend contract: any module reachable from a test validates
// against those real values rather than a mock (ADR 0014).
export default frontendProject({
  setupFiles: ['./src/tests/frontend/setup.ts'],
});
