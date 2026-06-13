// Import the plugin
import testingLibrary from 'eslint-plugin-testing-library';
import { defineConfig } from 'eslint/config';

export const testingConfig = defineConfig([
  // 1️⃣ Base config — optional, use your own shared setup first
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    ignores: ['node_modules', 'dist'],
  },

  // 2️⃣ Testing Library rules, scoped only to test files
  {
    files: ['**/__tests__/**/*.[jt]s?(x)', '**/?(*.)+(spec|test).[jt]s?(x)'],
    plugins: {
      'testing-library': testingLibrary,
    },

    // Use one of the built‑in configs: 'flat/react', 'flat/dom', etc.
    ...testingLibrary.configs['flat/react'],

    rules: {
      // You can add or override specific Testing Library rules here.
      'testing-library/no-debugging-utils': 'warn',
      'testing-library/no-wait-for-multiple-assertions': 'error',
      'testing-library/prefer-user-event': 'error',
    },
  },
]);
