import { baseConfig } from '@acme/eslint-config/base';
import { testingConfig } from '@acme/eslint-config/testing';

export default [
  {
    ignores: ['dist/**'],
  },
  ...baseConfig,
  ...testingConfig,
];
