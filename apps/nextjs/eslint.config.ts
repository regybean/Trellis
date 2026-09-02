import { baseConfig, restrictEnvAccess } from '@acme/eslint-config/base';
import { nextjsConfig } from '@acme/eslint-config/nextjs';
import { reactConfig } from '@acme/eslint-config/react';
import { securityConfig } from '@acme/eslint-config/security';
import { testingConfig } from '@acme/eslint-config/testing';

export default [
  {
    ignores: ['.next/**'],
  },
  ...baseConfig,
  ...reactConfig,
  ...securityConfig,
  ...restrictEnvAccess,
  ...testingConfig,
  ...nextjsConfig,
  {
    // instrumentation.ts runs before env validation and uses Next.js-specific
    // process.env variables that can't be validated through our env schema
    files: ['src/instrumentation.ts'],
    rules: {
      'no-restricted-properties': 'off',
      'turbo/no-undeclared-env-vars': 'off',
    },
  },
];
