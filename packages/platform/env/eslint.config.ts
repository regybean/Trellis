import { baseConfig, restrictEnvAccess } from '@acme/eslint-config/base';
import { securityConfig } from '@acme/eslint-config/security';
import { testingConfig } from '@acme/eslint-config/testing';

export default [
  {
    ignores: ['dist/**'],
  },
  ...baseConfig,
  ...securityConfig,
  ...testingConfig,
  ...restrictEnvAccess,
  // `should-skip-env-validation.ts` is this package's one `process.env` reader:
  // it inspects the *run* (lint step, Next build, vitest, CI) to decide whether
  // secrets can be supplied at all. Those signals are set by the tooling around
  // us, so neither the validated-env ban nor turbo's declared-env check applies.
  // Scoped to the two rules rather than ignoring the file, so everything else
  // still lints it.
  {
    files: ['src/should-skip-env-validation.ts'],
    rules: {
      'no-restricted-properties': 'off',
      'turbo/no-undeclared-env-vars': 'off',
    },
  },
];
