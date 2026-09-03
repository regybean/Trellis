import {
  baseConfig,
  containmentOverride,
  restrictEnvAccess,
} from '@acme/eslint-config/base';
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
  // The app owns auth *resolution* (ADR 0003) — `createAuthClient`, the mounted
  // handler, the middleware cookie check — so it is one of the two blessed homes
  // for a `better-auth` import. Mastra stays banned. And seam implementations
  // are constructed only in this app's composition root (ADR 0006).
  ...containmentOverride({
    allowBetterAuth: true,
    compositionRoot: 'src/server/deps.ts',
  }),
];
