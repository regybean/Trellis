import {
  baseConfig,
  containmentOverride,
  restrictEnvAccess,
} from '@acme/eslint-config/base';
import { securityConfig } from '@acme/eslint-config/security';

export default [
  {
    ignores: ['dist/**'],
  },
  ...baseConfig,
  ...securityConfig,
  ...restrictEnvAccess,
  // Blessed Mastra home (ADR 0002).
  ...containmentOverride({ allowMastra: true }),
];
