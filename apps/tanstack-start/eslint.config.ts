import { baseConfig, restrictEnvAccess } from '@acme/eslint-config/base';
import { reactConfig } from '@acme/eslint-config/react';
import { securityConfig } from '@acme/eslint-config/security';

export default [
  {
    ignores: [
      '.nitro/**',
      '.output/**',
      '.tanstack/**',
      'src/routeTree.gen.ts',
    ],
  },
  ...baseConfig,
  ...reactConfig,
  ...securityConfig,
  ...restrictEnvAccess,
  {
    // TanStack Router's `redirect()` / `notFound()` return plain control-flow
    // objects (not `Error`s) that are *meant* to be thrown from loaders,
    // `beforeLoad`, and server fns. Teach `only-throw-error` they're throwable.
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/only-throw-error': [
        'error',
        {
          allow: [
            {
              from: 'package',
              name: 'Redirect',
              package: '@tanstack/router-core',
            },
            {
              from: 'package',
              name: 'NotFoundError',
              package: '@tanstack/router-core',
            },
          ],
        },
      ],
    },
  },
];
