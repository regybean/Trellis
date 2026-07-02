/**
 * Backend Test Setup
 *
 * Runs before each test file (after `@acme/test-utils/hydrate-env`, which has
 * populated `process.env` with the testcontainer DB/Redis details). Every
 * `env.ts` validates against the real running services — no env mocks. Only the
 * behavioral boundaries are mocked here: the Stripe-calling utilities (keeping
 * the real typed-error seam), `@acme/subscriptions`, and `server-only`.
 */

import { afterEach, beforeEach, vi } from 'vitest';

import { cleanupTestData } from './utils/test-context';

// In-memory userId -> Stripe customer id store backing the @acme/subscriptions
// mock, so setStripeCustomerId/getStripeCustomerId round-trip within a test.
const stripeCustomerStore = vi.hoisted(() => new Map<string, string>());

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

// Mock rate limiting utilities — isTierAtLeast delegates to the real
// implementation from @acme/entitlements so requireTier gates behave correctly.
vi.mock('@acme/subscriptions', async () => {
  const { isTierAtLeast } = await import('@acme/entitlements');
  return {
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
    // userId <-> Stripe customer id mapping, backed by an in-memory store so
    // fixtures (setStripeCustomerId) and the router (getStripeCustomerId) agree.
    setStripeCustomerId: vi.fn((userId: string, customerId: string) => {
      stripeCustomerStore.set(userId, customerId);
      return Promise.resolve();
    }),
    getStripeCustomerId: vi.fn((userId: string | null) =>
      Promise.resolve(stripeCustomerStore.get(String(userId)) ?? null),
    ),
    setSubscriptionCache: vi.fn().mockResolvedValue(undefined),
    getSubscriptionType: vi.fn().mockReturnValue('Basic'),
    isTierAtLeast: vi.fn().mockImplementation(isTierAtLeast),
  };
});

// Clean up test data before each test for isolation
beforeEach(() => {
  // Reset all mocks between tests
  vi.clearAllMocks();
  stripeCustomerStore.clear();
});

// Clean up after each test
afterEach(async () => {
  try {
    await cleanupTestData();
  } catch {
    // Ignore cleanup errors (DB might not be connected in some test scenarios)
  }
});
