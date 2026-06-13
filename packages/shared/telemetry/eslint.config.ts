import { baseConfig } from '@acme/eslint-config/base';
import { securityConfig } from '@acme/eslint-config/security';

export default [
  {
    ignores: ['dist/**'],
  },
  ...baseConfig,
  ...securityConfig,
  {
    // Allow console in telemetry package - it's low-level infrastructure
    // that runs before logger is available
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
];
