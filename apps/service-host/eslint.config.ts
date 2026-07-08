import { baseConfig, restrictEnvAccess } from '@acme/eslint-config/base';
import { securityConfig } from '@acme/eslint-config/security';

export default [
  ...baseConfig,
  ...securityConfig,
  ...restrictEnvAccess,
  {
    // The server entrypoint reads FEATURE/PORT directly from process.env — it
    // boots before (and to select) any feature env schema, the same boundary
    // exemption apps/nextjs gives its instrumentation.ts.
    files: ['src/server.ts'],
    rules: {
      'no-restricted-properties': 'off',
      'turbo/no-undeclared-env-vars': 'off',
    },
  },
];
