import { defineConfig, mergeConfig } from 'vitest/config';

import { backendProject } from '@acme/test-utils/vitest';

// NEXT_PUBLIC_WEBAPP only drives the @acme/redis key namespace here (billing's
// own env has no webapp; its DB tables aren't schema-scoped by it), so any valid
// identifier works — `billing_test` doubles as Redis-prefix isolation alongside
// the dedicated logical DB. mockReset stays off: this suite relies on mock
// implementations persisting across tests (see setup.ts). Infra descriptors are
// declared in ./src/tests/backend/global-setup.ts.
export default mergeConfig(
  backendProject({
    webapp: 'billing_test',
    redisDb: '1',
    globalSetup: './src/tests/backend/global-setup.ts',
    setupFiles: ['./src/tests/backend/setup.ts'],
  }),
  defineConfig({
    test: {
      mockReset: false,
      // Overrides the shared backend default of `isolate: false`, which shares
      // one module registry across every file in the suite. This suite cannot
      // survive that, because its files declare *different* mock sets over the
      // same modules: `account.test.ts` stubs the two hosted-page functions of
      // `api/services/stripe-checkout`, `stripe-sync.test.ts` fakes
      // `api/services/stripe-client` outright, and the rest run both for real
      // against localstripe. In a shared registry whichever file imports a
      // module first decides what every later file sees, so the suite passed or
      // failed on file order — and vitest orders files by their cached
      // durations, which makes that order vary between machines and between runs
      // on one machine. Isolating per file gives each one the set it declares.
      isolate: true,
    },
  }),
);
