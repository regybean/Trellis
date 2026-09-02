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
    ignores: ['.next/**'],
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
