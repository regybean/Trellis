import { baseConfig, restrictEnvAccess } from '@acme/eslint-config/base';
import { reactConfig } from '@acme/eslint-config/react';
import { securityConfig } from '@acme/eslint-config/security';
import { testingConfig } from '@acme/eslint-config/testing';

/** @type {import('typescript-eslint').Config} */
export default [
  {
    ignores: ['.next/**'],
  },
  ...baseConfig,
  ...reactConfig,
  ...securityConfig,
  ...restrictEnvAccess,
  ...testingConfig,
];
