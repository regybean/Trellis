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
  // `read-env.ts` is this package's guarded `process.env` read — the one every
  // slice's `runtimeEnv` goes through (ADR 0001 §4). It is the same sanctioned
  // edge as an `env.ts`, factored out so the guard against touching `process` in
  // a browser bundle lives in one place. Scoped here, to this file in this
  // package, rather than a repo-wide `**/read-env.ts` ignore: the exemption is
  // for @acme/env being the central env mechanism (ADR 0001), so no other
  // package gets to opt out of the policy by choosing a filename.
  {
    files: ['src/read-env.ts'],
    rules: {
      'no-restricted-properties': 'off',
      'turbo/no-undeclared-env-vars': 'off',
    },
  },
];
