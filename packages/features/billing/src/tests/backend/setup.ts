/**
 * Backend Test Setup
 *
 * Runs before each test file (after `@acme/test-utils/hydrate-env`, which has
 * populated `process.env` with the testcontainer Postgres/Redis/localstripe
 * details). Every `env.ts` validates against the real running services — no env
 * mocks.
 *
 * **Billing's own Stripe seam is not mocked here.** The suite starts a
 * localstripe container of its own (`global-setup.ts`), so everything under
 * `api/services/` runs for real against a real Stripe server. Two calls have no
 * localstripe endpoint to run against — `createCheckoutSession` and
 * `createDashboardSession`, which produce Stripe-*hosted* pages that
 * ../../../docs/adr/0001-localstripe-dev-billing.md explicitly declined to
 * reproduce ("Reproducing hosted Checkout / Billing Portal locally … Rejected").
 * Both 404 on localstripe, so they are stubbed in
 * `integration/api/account.test.ts`, the one file that reaches them, beside
 * that reason. Nothing blanket.
 *
 * What is still mocked here, and why:
 *
 * - `server-only` — a Next.js build-time marker with no runtime implementation
 *   for vitest to load.
 * - `@acme/subscriptions`, **partially**: the `credits` façade only. That is the
 *   Redis rate-limit seam, a different seam from Stripe's and not this suite's
 *   subject, and the admin rate-limit procedures assert exact balances against
 *   it. Everything else in the package — the Stripe-customer mapping, the
 *   subscription cache read/write, `getSubscriptionType`, the cache schema — is
 *   the real module against the suite's isolated Redis DB, which
 *   `cleanupTestData` flushes between tests.
 *
 * The typed error seam (`utils/stripe-errors`) is real, as it always was: a
 * pure, side-effect-free module with no live Stripe or Redis at import, so the
 * router's error construction is exercised rather than stubbed.
 */

import { afterEach, beforeEach, vi } from 'vitest';

import type * as Subscriptions from '@acme/subscriptions';

import { cleanupTestData } from './utils/test-context';

// Mock server-only module - allows importing server components in vitest
vi.mock('server-only', () => ({}));

const CREDIT_LIMIT = 250;
const thirtyDaysOut = () => Math.floor(Date.now() / 1000) + 86_400 * 30;

// Deterministic credit balances for the admin rate-limit procedures. Spread
// over the real module so a real export is never shadowed by omission — the
// blanket hand-written mock this replaced had to re-declare every export, and
// went stale the moment the real code reached for one it had not listed.
vi.mock('@acme/subscriptions', async (importOriginal) => ({
  ...(await importOriginal<typeof Subscriptions>()),
  credits: {
    read: vi.fn().mockResolvedValue({
      remaining: 100,
      limit: CREDIT_LIMIT,
      resetAt: thirtyDaysOut(),
    }),
    consume: vi.fn(() => Promise.resolve()),
    reset: vi.fn().mockResolvedValue({
      tier: 'Basic',
      limit: CREDIT_LIMIT,
      resetAt: thirtyDaysOut(),
    }),
    maxOut: vi.fn().mockResolvedValue({
      tier: 'Basic',
      previousLimit: CREDIT_LIMIT,
      resetAt: thirtyDaysOut(),
    }),
    overrideExpiry: vi.fn().mockResolvedValue({
      tier: 'Basic',
      keyExisted: true,
      previousExpiryTimestamp: thirtyDaysOut(),
    }),
    status: vi.fn().mockResolvedValue({
      tier: 'Basic',
      remaining: 100,
      limit: CREDIT_LIMIT,
      resetAt: thirtyDaysOut(),
      keyExists: true,
    }),
  },
}));

// Clean up test data before each test for isolation
beforeEach(() => {
  // Reset all mocks between tests
  vi.clearAllMocks();
});

// Clean up after each test
afterEach(async () => {
  try {
    await cleanupTestData();
  } catch {
    // Ignore cleanup errors (DB might not be connected in some test scenarios)
  }
});
