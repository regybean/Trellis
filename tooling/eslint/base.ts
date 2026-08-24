import * as path from 'node:path';
import type { Linter } from 'eslint';
import { includeIgnoreFile } from '@eslint/compat';
import eslint from '@eslint/js';
import importPlugin from 'eslint-plugin-import';
import turboPlugin from 'eslint-plugin-turbo';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

/**
 * Vendor + slice containment guards.
 *
 * ESLint runs per-package (cwd = the package dir), so `files` globs here are
 * package-relative — they cannot key off a package's location in the tree.
 * The model is therefore "restrictive default + per-package exception":
 *
 *   - `defaultContainment` (below) bans Mastra + framework-specific Clerk in
 *     every package, plus direct tRPC in feature components. It is spread at
 *     the tail of both `baseConfig` and `restrictEnvAccess` so it is the last
 *     `no-restricted-imports` config for any file (flat config *replaces*, not
 *     merges, rule options — last match wins). Both carry it so the result is
 *     stable no matter which is composed last; packages that omit
 *     `restrictEnvAccess` (telemetry, ui) are still covered via `baseConfig`.
 *
 *   - The blessed exceptions (@acme/auth + apps for Clerk; @acme/rag +
 *     @acme/chat for Mastra) spread `containmentOverride(...)` at the very end
 *     of their own eslint.config, overriding the default for their files.
 *
 * Note: on files the default matches, `restrictEnvAccess`'s narrow
 * `import { env } from 'process'` ban is superseded — the real env guard
 * (`no-restricted-properties` on `process.env`) is a different rule and stays.
 */
const banMastra = {
  group: ['@mastra/*'],
  message:
    'Mastra imports are contained to @acme/rag and @acme/chat (ADR 0002). Consume them through those packages.',
};
const banClerkServer = {
  group: ['@clerk/nextjs/server', '@clerk/tanstack-react-start/server'],
  allowTypeImports: true,
  message:
    'Framework-specific Clerk server imports belong in apps or @acme/auth (ADR 0003). Inject auth through the neutral tRPC seam.',
};
const banFeatureTrpc = {
  group: ['**/trpc/react', '**/trpc/server', '@trpc/*'],
  message:
    'Feature components must not call tRPC directly — put data access in src/hooks/ (see CLAUDE.md → Slice contract enforcement).',
};

// Frontend test doctrine (ADR 0018): fake the data layer at the HTTP boundary
// with MSW, never `vi.mock` a seam the feature owns. Banning the mocks forces
// MSW and makes data-layer `toHaveBeenCalledWith(...)` assertions impossible
// (the spy can't be created). Framework externals (next/navigation, @acme/auth)
// stay mockable, mirroring the backend's blessed mock list (ADR 0014).
// `no-restricted-syntax` is flat-config replace (last match wins), so the
// override re-declares the shared console ban to keep it in force.
const banConsole = {
  selector: "CallExpression[callee.object.name='console']",
  message:
    "Direct console usage is not allowed. Use `import { logger } from '@acme/logger'` instead for structured logging.",
};
const banFrontendSeamMocks = [
  {
    selector:
      "CallExpression[callee.object.name='vi'][callee.property.name='mock'] > Literal[value=/trpc\\u002Freact$/]",
    message:
      'Frontend tests mock the network at the HTTP boundary (MSW), not the tRPC client you own (ADR 0018). Use trpcMsw + setupServer from your feature setup.',
  },
  {
    selector:
      "CallExpression[callee.object.name='vi'][callee.property.name='mock'] > Literal[value=/^\\.\\.?\\u002F.*hooks/]",
    message:
      "Frontend tests must not mock a feature's own hook — the hook is the contract under test (ADR 0018). Drive it through MSW and assert the observable outcome.",
  },
  {
    selector:
      "CallExpression[callee.object.name='vi'][callee.property.name='mock'] > Literal[value=/^react-toastify$/]",
    message:
      'Assert toasts via a real <ToastContainer /> in the DOM, not a mocked react-toastify (ADR 0018). Toast output is user-visible, not a true external.',
  },
];

type ImportPattern = {
  group: string[];
  message: string;
  allowTypeImports?: boolean;
};

/** A `no-restricted-imports` error entry banning the given import patterns. */
const banImports = (patterns: ImportPattern[]): Linter.RuleEntry => [
  'error',
  { patterns },
];

const defaultContainment = defineConfig(
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': banImports([banMastra, banClerkServer]),
    },
  },
  // Slice contract: feature components stay UI-only (no tRPC, no vendors).
  // Harmless elsewhere — non-feature packages don't import feature tRPC.
  {
    files: ['src/components/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': banImports([
        banFeatureTrpc,
        banMastra,
        banClerkServer,
      ]),
    },
  },
);

/**
 * Per-package exception to the containment default. Spread this at the *end* of
 * a package's eslint.config (after `restrictEnvAccess`) so it wins. Pass
 * `allowMastra`/`allowClerk` for the blessed vendor homes; `feature: true`
 * re-asserts the component tRPC ban when a feature also relaxes a vendor.
 */
export function containmentOverride({
  allowMastra = false,
  allowClerk = false,
  feature = false,
} = {}) {
  const patterns: ImportPattern[] = [
    ...(allowMastra ? [] : [banMastra]),
    ...(allowClerk ? [] : [banClerkServer]),
  ];
  return defineConfig(
    {
      files: ['**/*.{ts,tsx}'],
      rules: { 'no-restricted-imports': banImports(patterns) },
    },
    ...(feature
      ? [
          {
            files: ['src/components/**/*.{ts,tsx}'],
            rules: {
              'no-restricted-imports': banImports([
                banFeatureTrpc,
                ...patterns,
              ]),
            },
          },
        ]
      : []),
  );
}

/**
 * All packages that leverage t3-env should use this rule
 */
export const restrictEnvAccess = defineConfig(
  {
    ignores: [
      '**/env.ts',
      // env-providers.ts holds the internal per-provider env schemas (kept out
      // of the public env.ts seam); it is an env-config file and reads
      // process.env just like env.ts.
      '**/env-providers.ts',
    ],
  },
  {
    files: ['**/*.js', '**/*.ts', '**/*.tsx'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message:
            "Use `import { env } from '~/env'` instead to ensure validated types.",
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          name: 'process',
          importNames: ['env'],
          message:
            "Use `import { env } from '~/env'` instead to ensure validated types.",
        },
      ],
    },
  },
  // Spread last so vendor/slice containment wins over the env-import ban above
  // for the files it matches (see the note on `defaultContainment`).
  ...defaultContainment,
  // Tests legitimately read process.env (setup files, vi.stubEnv, hydrate-env),
  // so exempt them from the env-access rule — but keep them fully linted by
  // everything else. This replaces the previous *global* ignore of `tests/**`,
  // which silently removed every test file from linting (and killed the
  // test-scoped configs, e.g. eslint-plugin-testing-library).
  {
    files: ['**/tests/**/*.{js,ts,tsx}', '**/*.test.{js,ts,tsx}'],
    rules: {
      // Only the process.env property rule is relaxed; vendor/slice containment
      // (`no-restricted-imports`) stays in force for tests.
      'no-restricted-properties': 'off',
    },
  },
);

export const baseConfig = defineConfig(
  // Ignore files not tracked by VCS and any config files
  includeIgnoreFile(path.join(import.meta.dirname, '../../.gitignore')),
  { ignores: ['**/*.config.*'] },
  {
    files: ['**/*.js', '**/*.ts', '**/*.tsx'],
    plugins: {
      import: importPlugin,
      turbo: turboPlugin,
    },
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    rules: {
      ...turboPlugin.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/no-misused-promises': [
        2,
        { checksVoidReturn: { attributes: false } },
      ],
      '@typescript-eslint/no-unnecessary-condition': [
        'error',
        {
          allowConstantLoopConditions: true,
        },
      ],
      '@typescript-eslint/no-non-null-assertion': 'error',
      'import/consistent-type-specifier-style': ['error', 'prefer-top-level'],
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='console']",
          message:
            "Direct console usage is not allowed. Use `import { logger } from '@acme/logger'` instead for structured logging.",
        },
      ],
    },
  },
  {
    linterOptions: { reportUnusedDisableDirectives: true },
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  // Frontend test doctrine: ban mocking the seams a feature owns (ADR 0018).
  {
    files: ['**/tests/frontend/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': ['error', banConsole, ...banFrontendSeamMocks],
    },
  },
  // Vendor/slice containment (also spread into restrictEnvAccess; see note).
  // Present here so packages that omit restrictEnvAccess (telemetry, ui) are
  // still guarded.
  ...defaultContainment,
);
