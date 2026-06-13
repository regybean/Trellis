import type { PluginConfig } from '@ianvs/prettier-plugin-sort-imports';
import type { Config } from 'prettier';
import type { PluginOptions } from 'prettier-plugin-tailwindcss';

const config = {
  plugins: [
    '@ianvs/prettier-plugin-sort-imports',
    'prettier-plugin-tailwindcss',
  ],
  bracketSpacing: true,
  endOfLine: 'lf',
  printWidth: 80,
  semi: true,
  singleQuote: true,
  tabWidth: 2,
  trailingComma: 'all',
  tailwindFunctions: ['cn', 'cva'],
  importOrder: [
    '<TYPES>',
    '^(react/(.*)$)|^(react$)|^(react-native(.*)$)',
    '^(next/(.*)$)|^(next$)',
    '^(expo(.*)$)|^(expo$)',
    '<THIRD_PARTY_MODULES>',
    '',
    '<TYPES>^@acme',
    '^@acme/(.*)$',
    '',
    '<TYPES>^[.|..|~]',
    '^~/',
    '^[../]',
    '^[./]',
  ],
  importOrderParserPlugins: ['typescript', 'jsx', 'decorators-legacy'],
  importOrderTypeScriptVersion: '4.4.0',
  overrides: [
    {
      files: '*.json.hbs',
      options: {
        parser: 'json',
      },
    },
    {
      files: '*.js.hbs',
      options: {
        parser: 'babel',
      },
    },
  ],
} satisfies Config & PluginConfig & PluginOptions;

export default config;
