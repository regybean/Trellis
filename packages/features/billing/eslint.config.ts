import { baseConfig, restrictEnvAccess } from '@acme/eslint-config/base';
import { reactConfig } from '@acme/eslint-config/react';
import { securityConfig } from '@acme/eslint-config/security';
import { testingConfig } from '@acme/eslint-config/testing';

export default [
  {
    // scripts/ holds standalone node-run dev tooling (e.g. seed-localstripe),
    // outside the src tsconfig project — exclude from type-aware linting.
    ignores: ['.next/**', 'scripts/**'],
  },
  ...baseConfig,
  ...reactConfig,
  ...securityConfig,
  ...restrictEnvAccess,
  ...testingConfig,
];
