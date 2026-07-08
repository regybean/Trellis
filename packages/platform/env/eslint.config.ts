import { baseConfig, restrictEnvAccess } from '@acme/eslint-config/base';
import { securityConfig } from '@acme/eslint-config/security';
import { testingConfig } from '@acme/eslint-config/testing';

export default [
  {
    ignores: ['dist/**'],
  },
  ...baseConfig,
  ...securityConfig,
  ...testingConfig,
  // `src/env.ts` is the one file that reads `process.env` to make the
  // skip decision — it is matched by restrictEnvAccess's `**/env.ts` ignore,
  // so the no-restricted-properties ban doesn't (and shouldn't) apply to it.
  ...restrictEnvAccess,
];
