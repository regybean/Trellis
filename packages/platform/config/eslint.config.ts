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
  // Config is pure — it never reads `process.env`; the ban applies in full.
  ...restrictEnvAccess,
];
