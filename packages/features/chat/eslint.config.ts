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
  // Blessed Mastra home (ADR 0002); still a feature, so components keep the
  // no-direct-tRPC slice contract.
  ...containmentOverride({ allowMastra: true, feature: true }),
];
