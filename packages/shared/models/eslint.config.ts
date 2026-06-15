import { baseConfig, restrictEnvAccess } from '@acme/eslint-config/base';
import { securityConfig } from '@acme/eslint-config/security';

export default [
  {
    ignores: ['dist/**'],
  },
  ...baseConfig,
  ...securityConfig,
  ...restrictEnvAccess,
];
