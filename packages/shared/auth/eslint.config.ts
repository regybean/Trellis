import {
  baseConfig,
  containmentOverride,
  restrictEnvAccess,
} from '@acme/eslint-config/base';
import { reactConfig } from '@acme/eslint-config/react';
import { securityConfig } from '@acme/eslint-config/security';
import { testingConfig } from '@acme/eslint-config/testing';

export default [
  {
    // scripts/ holds standalone node-run dev tooling (e.g. promote-admin),
    // outside the src tsconfig project — exclude from type-aware linting.
    ignores: ['.next/**', 'scripts/**'],
  },
  ...baseConfig,
  ...reactConfig,
  ...securityConfig,
  ...restrictEnvAccess,
  ...testingConfig,
  // The vendor home: this package *is* the Better Auth instance (`initAuth`) and
  // the tables it reads, so the tree-wide ban is lifted here and nowhere else in
  // `packages/`. Mastra stays banned.
  ...containmentOverride({ allowBetterAuth: true }),
];
