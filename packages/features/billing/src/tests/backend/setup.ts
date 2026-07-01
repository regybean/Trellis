/* eslint-disable no-restricted-properties */
/**
 * Backend Test Setup
 *
 * This file runs before each test file. It's responsible for:
 * - Mocking env.ts to provide test configuration
 * - Setting up mocks for external services (Stripe, Redis, etc.)
 * - Configuring test-specific behavior based on environment variables
 * - Cleaning up data between tests
 */

import { afterEach, beforeEach, inject, vi } from 'vitest';

import { cleanupTestData } from './utils/test-context';

// Mock the env module using factory function pattern
// The factory function receives the inject values at runtime, not at module load time
vi.mock('../../env', () => {
  const REDIS_URL = inject('REDIS_URL');
  const DB_HOST = inject('DB_HOST');
  const DB_PORT = inject('DB_PORT');
  const DB_USER = inject('DB_USER');
  const DB_PASSWORD = inject('DB_PASSWORD');
  const DB_NAME = inject('DB_NAME');

  return {
    env: {
      NODE_ENV: 'test',
      DB_HOST: DB_HOST,
      DB_PORT: DB_PORT,
      DB_USER: DB_USER,
      DB_PASSWORD: DB_PASSWORD,
      DB_NAME: DB_NAME,
      REDIS_URL: REDIS_URL,
      STRIPE_SECRET_KEY: 'sk_test_12345',
      STRIPE_WEBHOOK_SECRET: 'whsec_test_12345',
      STRIPE_SUCCESS_URL: 'http://localhost:3000/success',
      STRIPE_CANCEL_URL: 'http://localhost:3000/cancel',
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_12345',
      NEXT_PUBLIC_STRIPE_MANAGE_BILLING_URL: 'https://billing.example.com',
      NEXT_PUBLIC_STRIPE_PRO_PLAN_ID: 'prod_pro_12345',
      NEXT_PUBLIC_STRIPE_STANDARD_PLAN_ID: 'prod_standard_12345',
    },
  };
});

vi.mock('@acme/redis/env', () => {
  // Pin this package's tests to a dedicated Redis logical DB. cleanupTestData
  // calls flushDb(), which clears the whole selected DB — turbo runs feature
  // test suites in parallel against one shared Redis, so without per-package
  // DBs one suite's flush wipes another's keys mid-test.
  const injected = inject('REDIS_URL');
  if (!injected) throw new Error('REDIS_URL not provided to test workers');
  const REDIS_URL = `${injected.replace(/\/+$/, '')}/1`;

  return {
    env: {
      REDIS_URL: REDIS_URL,
    },
  };
});

// Mock server-only module - allows importing server components in vitest
vi.mock('server-only', () => ({}));

// Mock the Stripe-calling utilities, but keep the real typed-error seam
// (billingError / BillingErrorCode / toBillingErrorCode) so the router's error
// construction is exercised for real rather than stubbed. stripe-errors is a
// pure, side-effect-free module, so importActual on it is safe (no live
// Stripe/Redis at import).
vi.mock('../../utils/stripe', async () => {
  const errors = await vi.importActual<
    typeof import('../../utils/stripe-errors')
  >('../../utils/stripe-errors');
  return {
    billingError: errors.billingError,
    BillingErrorCode: errors.BillingErrorCode,
    toBillingErrorCode: errors.toBillingErrorCode,
    getProductWithPrice: vi.fn().mockResolvedValue({
      defaultPriceId: 'price_12345',
      productId: 'prod_12345',
    }),
    findOrCreateCustomer: vi.fn().mockResolvedValue({
      customer: { id: 'cus_12345', email: 'test@example.com' },
      isExisting: false,
    }),
    createCheckoutSession: vi.fn().mockResolvedValue({
      id: 'cs_12345',
      url: 'https://checkout.stripe.com/test',
      created: 1_234_567_890,
    }),
    createDashboardSession: vi.fn().mockResolvedValue({
      billingPortalUrl: 'https://billing.stripe.com/test',
    }),
    syncStripeDataToKV: vi.fn().mockResolvedValue(null),
    setUserTier: vi.fn().mockResolvedValue({ status: 'active' }),
  };
});

// Mock rate limiting utilities
vi.mock('@acme/subscriptions', () => ({
  credits: {
    read: vi.fn().mockResolvedValue({
      remaining: 100,
      limit: 250,
      resetAt: Math.floor(Date.now() / 1000) + 86_400 * 30,
    }),
    consume: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn().mockResolvedValue({
      tier: 'Basic',
      limit: 250,
      resetAt: Math.floor(Date.now() / 1000) + 86_400 * 30,
    }),
    maxOut: vi.fn().mockResolvedValue({
      tier: 'Basic',
      previousLimit: 250,
      resetAt: Math.floor(Date.now() / 1000) + 86_400 * 30,
    }),
    overrideExpiry: vi.fn().mockResolvedValue({
      tier: 'Basic',
      keyExisted: true,
      previousExpiryTimestamp: Math.floor(Date.now() / 1000) + 86_400 * 30,
    }),
    status: vi.fn().mockResolvedValue({
      tier: 'Basic',
      remaining: 100,
      limit: 250,
      resetAt: Math.floor(Date.now() / 1000) + 86_400 * 30,
      keyExists: true,
    }),
  },
  getUserSubscriptionFromRedis: vi.fn().mockResolvedValue({ status: 'none' }),
  // Redis key builders used by test fixtures — deterministic, mirror nsKey format.
  stripeUserKey: vi.fn(
    (userId: string | null) => `stripe:user:${String(userId)}`,
  ),
  stripeCustomerKey: vi.fn(
    (customerId: string) => `stripe:customer:${customerId}`,
  ),
  getSubscriptionType: vi.fn().mockReturnValue('Basic'),
  // Real tier ordering (Basic < Standard < Pro) so requireTier gates behave
  // correctly under test.
  isTierAtLeast: vi.fn((tier: string, minTier: string) => {
    const rank: Record<string, number> = { Basic: 0, Standard: 1, Pro: 2 };
    return (rank[tier] ?? 0) >= (rank[minTier] ?? 0);
  }),
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
