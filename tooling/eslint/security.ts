import pluginSecurity from 'eslint-plugin-security';
import pluginSonar from 'eslint-plugin-sonarjs';
import pluginUnicorn from 'eslint-plugin-unicorn';
import { defineConfig } from 'eslint/config';

export const securityConfig = defineConfig({
  files: ['**/*.ts', '**/*.tsx'],
  plugins: {
    security: pluginSecurity,
    sonarjs: pluginSonar,
    unicorn: pluginUnicorn,
  },
  rules: {
    ...pluginSecurity.configs.recommended.rules,
    ...pluginSonar.configs.recommended.rules,
    ...pluginUnicorn.configs.recommended.rules,

    // Override currently unneeded rules
    'sonarjs/no-commented-code': 'off',
    'sonarjs/prefer-read-only-props': 'off',
    'sonarjs/todo-tag': 'off',
    'sonarjs/pseudo-random': 'off',
    // Set to warn instead of error
    'sonarjs/no-unused-vars': 'warn',
    'sonarjs/no-dead-store': 'warn',
    'unicorn/no-null': 'off',
    'unicorn/prefer-module': 'off',
    'unicorn/prevent-abbreviations': 'off',
  },
});
