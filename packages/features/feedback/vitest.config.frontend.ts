import { frontendProject } from '@acme/test-utils/vitest';

export default frontendProject({
  setupFiles: ['./src/tests/frontend/setup.tsx'],
});
