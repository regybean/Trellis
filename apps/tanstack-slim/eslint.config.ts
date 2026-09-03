import {
  baseConfig,
  containmentOverride,
  restrictEnvAccess,
} from '@acme/eslint-config/base';
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
    // The telemetry bootstrap runs before env validation and reads runtime OTel
    // vars that can't go through our env schema — same exemption apps/nextjs
    // gives its instrumentation.ts (the equivalent boundary hook).
    files: ['src/nitro/telemetry.ts'],
    rules: {
      'no-restricted-properties': 'off',
      'turbo/no-undeclared-env-vars': 'off',
    },
  },
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
  // No auth provider and no Stripe in this app's graph (ADR 0010), so the vendor
  // containment default stands unrelaxed. What this adds is the composition
  // root: seam implementations are constructed in one file per app (ADR 0006),
  // and for a slim app that file is where "unmetered" is chosen.
  ...containmentOverride({ compositionRoot: 'src/server/deps.ts' }),
];
