import { baseConfig } from '@acme/eslint-config/base';
import { reactConfig } from '@acme/eslint-config/react';
import { securityConfig } from '@acme/eslint-config/security';

export default [
  {
    ignores: ['.next/**'],
  },
  ...baseConfig,
  ...reactConfig,
  ...securityConfig,
];
