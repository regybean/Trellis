/**
 * Account Router Tests
 *
 * Testing philosophy:
 * - Test auth/validation ONCE since all procedures use the same middleware
 * - Focus on BUSINESS LOGIC with real Redis scenarios
 * - Test with "zero, one, many" pattern for data
 * - Real Redis and a real Stripe server (localstripe) via testcontainers
 * - Stub only the two hosted-page calls localstripe has no endpoint for
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as StripeCheckout from '../../../../api/services/stripe-checkout';
import type { TestContextOptions } from '../../utils/test-context';
import { appRouter } from '../../../../api/root';
import { getStripe } from '../../../../api/services/stripe-client';
import { env, toPlanIds } from '../../../../env';
import { seedLocalstripePlans } from '../../../../testing';
import { BillingErrorCode } from '../../../../utils/stripe-errors';
import {
  createTestSubscription,
  createTestUserId,
  setupTestStripeCustomer,
} from '../../utils/fixtures';
import { cleanupTestData, createTestContext } from '../../utils/test-context';

// The only two Stripe calls in this slice localstripe cannot serve, stubbed
// here rather than in the shared setup because this is the one file that
// reaches them.
//
// Both build a Stripe-*hosted* page: `checkout.sessions.create` and
// `billingPortal.sessions.create`. localstripe 1.15.10 answers 404 on
// /v1/checkout/sessions and /v1/billing_portal/sessions, and
// ../../../../../docs/adr/0001-localstripe-dev-billing.md decided that on
// purpose — "Reproducing hosted Checkout / Billing Portal locally. localstripe
// serves the API, not Stripe's hosted pages. Rebuilding them would be large and
// divergent from production … Rejected." So there is nothing to cross the seam
// to, and the stub stands in for Stripe's own page rather than for our code.
//
// Everything else in `stripe-checkout` — the product/price lookup, the customer
// resolve, the active-subscription guard — is the real module, imported through
// the factory and run against the container.
vi.mock('../../../../api/services/stripe-checkout', async (importOriginal) => ({
  ...(await importOriginal<typeof StripeCheckout>()),
  createCheckoutSession: vi.fn().mockResolvedValue({
    id: 'cs_12345',
    url: 'https://checkout.stripe.com/test',
    created: 1_234_567_890,
  }),
  createDashboardSession: vi.fn().mockResolvedValue({
    billingPortalUrl: 'https://billing.stripe.com/test',
  }),
}));

const planIds = toPlanIds(env);

// Helper to create a tRPC caller with the given context options
function createCaller(opts: TestContextOptions) {
  const ctx = createTestContext(opts);
  return appRouter.createCaller(ctx);
}

const adminCaller = () =>
  createCaller({
    userId: createTestUserId('admin'),
    role: 'admin',
    tier: 'Basic',
    credits: { remaining: 250, limit: 250, resetAt: Date.now() },
  });

const subscriberCaller = (userId: string) =>
  createCaller({
    userId,
    role: 'user',
    tier: 'Basic',
    credits: { remaining: 250, limit: 250, resetAt: Date.now() },
  });

// localstripe keeps products and plans in memory, so a fresh container has
// none. Seeded once per file through the same function `pnpm infra:up` uses, so
// the products the checkout path looks up are the ones the env names.
beforeAll(async () => {
  await seedLocalstripePlans(getStripe(), planIds);
});

describe('accountRouter', () => {
  beforeEach(async () => {
    await cleanupTestData();
  });

  // ==========================================================================
  // MIDDLEWARE TESTS (test once since all procedures share the same middleware)
  // ==========================================================================
  describe('middleware (tested once)', () => {
    describe('adminProcedure authorization', () => {
      it('rejects non-admin users', async () => {
        const caller = createCaller({
          userId: createTestUserId(),
          role: 'user',
          tier: 'Basic',
          credits: { remaining: 250, limit: 250, resetAt: Date.now() },
        });

        await expect(
          caller.account.resetUserRateLimit({
            userId: createTestUserId('target'),
          }),
        ).rejects.toMatchObject({
          code: 'UNAUTHORIZED',
        });
      });

      it('allows admin users', async () => {
        const targetUserId = createTestUserId('target');
        const adminUserId = createTestUserId('admin');

        // Set up target user in Redis
        await setupTestStripeCustomer(targetUserId);

        const caller = createCaller({
          userId: adminUserId,
          role: 'admin',
          tier: 'Basic',
          credits: { remaining: 250, limit: 250, resetAt: Date.now() },
        });

        const result = await caller.account.resetUserRateLimit({
          userId: targetUserId,
        });

        expect(result).toMatchObject({
          userId: targetUserId,
          message: expect.stringContaining('Successfully reset'),
        });
      });
    });

    describe("requireTier('Standard')", () => {
      it('rejects users without subscription', async () => {
        const userId = createTestUserId();
        await setupTestStripeCustomer(userId);

        const caller = createCaller({
          userId,
          role: 'user',
          tier: 'Basic',
          credits: { remaining: 250, limit: 250, resetAt: Date.now() },
        });

        await expect(caller.account.standardFeature()).rejects.toMatchObject({
          code: 'FORBIDDEN',
        });
      });
    });

    describe("requireTier('Pro')", () => {
      it('rejects users without Pro subscription', async () => {
        const userId = createTestUserId();
        await setupTestStripeCustomer(userId);

        const caller = createCaller({
          userId,
          role: 'user',
          tier: 'Standard',
          credits: { remaining: 250, limit: 250, resetAt: Date.now() },
        });

        await expect(caller.account.proFeature()).rejects.toMatchObject({
          code: 'FORBIDDEN',
        });
      });
    });
  });

  // ==========================================================================
  // BUSINESS LOGIC: createCheckoutSession
  // ==========================================================================
  describe('createCheckoutSession', () => {
    it('opens a Stripe customer and resolves the product for a new subscriber', async () => {
      const userId = createTestUserId();

      const result = await subscriberCaller(
        userId,
      ).account.createCheckoutSession({ productId: planIds.standardPlanId });

      // The customer is real — `findOrCreateCustomer` created it in the
      // container, so the id is whatever Stripe assigned rather than a fixture.
      expect(result.customerId).toMatch(/^cus_/);
      expect(result.isReturningCustomer).toBe(false);
      expect(
        await getStripe().customers.retrieve(result.customerId),
      ).toMatchObject({ id: result.customerId, metadata: { userId } });

      // The session is the stub: the one hop that has no localstripe endpoint.
      expect(result).toMatchObject({
        sessionId: 'cs_12345',
        checkoutUrl: 'https://checkout.stripe.com/test',
      });
    });

    it('reuses the customer it already opened on a second checkout', async () => {
      const userId = createTestUserId();
      const caller = subscriberCaller(userId);

      const first = await caller.account.createCheckoutSession({
        productId: planIds.standardPlanId,
      });
      const second = await caller.account.createCheckoutSession({
        productId: planIds.standardPlanId,
      });

      expect(second.customerId).toBe(first.customerId);
      expect(second.isReturningCustomer).toBe(true);
    });

    // The legacy Plans fallback in `getProductWithPrice`: localstripe products
    // carry no `default_price`, so the lookup has to fall through to
    // `plans.list` or every checkout fails. See ADR 0001 decision 3.
    it('resolves the price from the legacy plan when the product has no default_price', async () => {
      const product = await getStripe().products.retrieve(planIds.proPlanId);
      expect(product.default_price).toBeUndefined();

      const result = await subscriberCaller(
        createTestUserId(),
      ).account.createCheckoutSession({ productId: planIds.proPlanId });

      expect(result.sessionId).toBe('cs_12345');
    });

    it('rejects a product that does not exist in Stripe', async () => {
      await expect(
        subscriberCaller(createTestUserId()).account.createCheckoutSession({
          productId: 'prod_not_seeded',
        }),
      ).rejects.toMatchObject({
        code: 'INTERNAL_SERVER_ERROR',
        message: BillingErrorCode.StripeUnavailable,
      });
    });

    // `validateNoActiveSubscription` only runs on the returning-customer
    // branch, so the subscription has to be a real one: granted through
    // `setUserTier`, which creates it in the container.
    it('rejects a customer who already has an active subscription', async () => {
      const userId = createTestUserId();

      await adminCaller().account.setUserTier({
        userId,
        email: 'test@example.com',
        tier: 'Pro',
        productId: planIds.proPlanId,
      });

      await expect(
        subscriberCaller(userId).account.createCheckoutSession({
          productId: planIds.standardPlanId,
        }),
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: BillingErrorCode.ActiveSubscription,
      });
    });
  });

  // ==========================================================================
  // BUSINESS LOGIC: createDashboardSession
  // ==========================================================================
  // The portal URL itself is the stub — Stripe hosts that page and localstripe
  // does not serve it (ADR 0001, as above). What is real here is the router's
  // own contract: it refuses to open a portal for a user with no customer
  // mapping, and passes the mapped customer through when there is one.
  describe('createDashboardSession', () => {
    it('creates billing portal session for user with Stripe customer', async () => {
      const userId = createTestUserId();
      await setupTestStripeCustomer(userId);

      const caller = createCaller({
        userId,
        role: 'user',
        tier: 'Basic',
        credits: { remaining: 250, limit: 250, resetAt: Date.now() },
      });

      const result = await caller.account.createDashboardSession();

      expect(result).toMatchObject({
        success: true,
        billingPortalUrl: 'https://billing.stripe.com/test',
      });
    });

    it('rejects user without Stripe customer ID', async () => {
      const userId = createTestUserId();
      // Note: NOT setting up Stripe customer

      const caller = createCaller({
        userId,
        role: 'user',
        tier: 'Basic',
        credits: { remaining: 250, limit: 250, resetAt: Date.now() },
      });

      await expect(
        caller.account.createDashboardSession(),
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: BillingErrorCode.NoCustomer,
      });
    });
  });

  // ==========================================================================
  // BUSINESS LOGIC: getSubscriptionDetails
  // ==========================================================================
  describe('getSubscriptionDetails', () => {
    it('returns none status for user without subscription', async () => {
      const caller = createCaller({
        userId: createTestUserId(),
        role: 'user',
        tier: 'Basic',
        credits: { remaining: 250, limit: 250, resetAt: Date.now() },
      });

      const result = await caller.account.getSubscriptionDetails();

      expect(result).toMatchObject({
        subscription: 'Basic',
        status: 'none',
        currentPeriodEnd: null,
        currentPeriodStart: null,
        cancelAtPeriodEnd: false,
      });
    });

    it('returns active subscription details', async () => {
      const periodStart = Math.floor(Date.now() / 1000);
      const periodEnd = periodStart + 86_400 * 30;

      const caller = createCaller({
        userId: createTestUserId(),
        role: 'user',
        tier: 'Pro',
        credits: { remaining: 250, limit: 250, resetAt: Date.now() },
      });

      const result = await caller.account.getSubscriptionDetails();

      expect(result).toMatchObject({
        subscription: 'Pro',
        status: 'active',
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
      });
    });
  });

  // ==========================================================================
  // BUSINESS LOGIC: getCreditUsage
  // ==========================================================================
  describe('getCreditUsage', () => {
    it('returns token usage for user', async () => {
      const resetAt = Math.floor(Date.now() / 1000) + 86_400 * 30;

      const caller = createCaller({
        userId: createTestUserId(),
        role: 'user',
        tier: 'Basic',
        credits: { remaining: 50, limit: 250, resetAt },
      });

      const result = await caller.account.getCreditUsage();

      expect(result).toMatchObject({
        remaining: 50,
        limit: 250,
        resetAt,
        usagePercentage: 80, // (250-50)/250 * 100 = 80%
      });
    });

    it('calculates correct usage percentage with no usage', async () => {
      const caller = createCaller({
        userId: createTestUserId(),
        role: 'user',
        tier: 'Basic',
        credits: { remaining: 250, limit: 250, resetAt: Date.now() },
      });

      const result = await caller.account.getCreditUsage();

      expect(result.usagePercentage).toBe(0);
    });

    it('calculates correct usage percentage when fully used', async () => {
      const caller = createCaller({
        userId: createTestUserId(),
        role: 'user',
        tier: 'Basic',
        credits: { remaining: 0, limit: 250, resetAt: Date.now() },
      });

      const result = await caller.account.getCreditUsage();

      expect(result.usagePercentage).toBe(100);
    });
  });

  // ==========================================================================
  // ADMIN: getUserRateLimitStatus
  // ==========================================================================
  describe('getUserRateLimitStatus', () => {
    it('returns rate limit status for target user', async () => {
      const targetUserId = createTestUserId('target');
      const adminUserId = createTestUserId('admin');

      // Set up target user in Redis
      await setupTestStripeCustomer(targetUserId);

      const caller = createCaller({
        userId: adminUserId,
        role: 'admin',
        tier: 'Basic',
        credits: { remaining: 250, limit: 250, resetAt: Date.now() },
      });

      const result = await caller.account.getUserRateLimitStatus({
        userId: targetUserId,
      });

      expect(result).toMatchObject({
        userId: targetUserId,
        tier: 'Basic',
        remaining: expect.any(Number),
        limit: expect.any(Number),
      });
    });
  });

  // ==========================================================================
  // ADMIN: getUserSubscription
  // ==========================================================================
  describe('getUserSubscription', () => {
    it('returns subscription details for target user', async () => {
      const targetUserId = createTestUserId('target');
      const adminUserId = createTestUserId('admin');

      // Set up target user in Redis
      await setupTestStripeCustomer(targetUserId);

      const caller = createCaller({
        userId: adminUserId,
        role: 'admin',
        tier: 'Basic',
        credits: { remaining: 250, limit: 250, resetAt: Date.now() },
      });

      const result = await caller.account.getUserSubscription({
        userId: targetUserId,
      });

      expect(result).toMatchObject({
        userId: targetUserId,
        subscription: expect.objectContaining({
          status: expect.any(String),
        }),
      });
    });
  });

  // ==========================================================================
  // ADMIN: resetUserRateLimit
  // ==========================================================================
  describe('resetUserRateLimit', () => {
    it('resets rate limit for target user', async () => {
      const targetUserId = createTestUserId('target');
      const adminUserId = createTestUserId('admin');

      // Set up target user in Redis
      await setupTestStripeCustomer(targetUserId);

      const caller = createCaller({
        userId: adminUserId,
        role: 'admin',
        tier: 'Basic',
        credits: { remaining: 250, limit: 250, resetAt: Date.now() },
      });

      const result = await caller.account.resetUserRateLimit({
        userId: targetUserId,
      });

      expect(result).toMatchObject({
        userId: targetUserId,
        newCreditCount: 250, // Mocked credit limit
        tier: 'Basic',
        message: expect.stringContaining('Successfully reset'),
      });
    });
  });

  // ==========================================================================
  // ADMIN: maxOutUserRateLimit
  // ==========================================================================
  describe('maxOutUserRateLimit', () => {
    it('exhausts rate limit for target user', async () => {
      const targetUserId = createTestUserId('target');
      const adminUserId = createTestUserId('admin');

      // Set up target user in Redis
      await setupTestStripeCustomer(targetUserId);

      const caller = createCaller({
        userId: adminUserId,
        role: 'admin',
        tier: 'Basic',
        credits: { remaining: 250, limit: 250, resetAt: Date.now() },
      });

      const result = await caller.account.maxOutUserRateLimit({
        userId: targetUserId,
      });

      expect(result).toMatchObject({
        userId: targetUserId,
        newCreditCount: 0,
        previousLimit: 250,
        tier: 'Basic',
        message: expect.stringContaining('Successfully maxed out'),
      });
    });
  });

  // ==========================================================================
  // ADMIN: overrideUserRateLimitExpiry
  // ==========================================================================
  describe('overrideUserRateLimitExpiry', () => {
    it('overrides expiry timestamp for target user', async () => {
      const targetUserId = createTestUserId('target');
      const adminUserId = createTestUserId('admin');
      const newExpiry = Math.floor(Date.now() / 1000) + 86_400 * 60; // 60 days from now

      const caller = createCaller({
        userId: adminUserId,
        role: 'admin',
        tier: 'Basic',
        credits: { remaining: 250, limit: 250, resetAt: Date.now() },
      });

      const result = await caller.account.overrideUserRateLimitExpiry({
        userId: targetUserId,
        expiryTimestamp: newExpiry,
      });

      expect(result).toMatchObject({
        userId: targetUserId,
        newExpiryTimestamp: newExpiry,
        message: expect.stringContaining('Successfully overrode expiry'),
      });
    });
  });

  // `setUserTier` has no block here: it is driven against localstripe for real
  // — grant, re-grant, downgrade and both input refusals — in
  // ./set-user-tier.test.ts. What used to sit here asserted the same procedure
  // against a `vi.fn().mockResolvedValue({ status: 'active' })`, which could
  // only ever agree with itself.

  // ==========================================================================
  // SUBSCRIPTION FEATURES
  // ==========================================================================
  describe('subscription features', () => {
    describe('standardFeature', () => {
      it('allows users with Standard subscription', async () => {
        const userId = createTestUserId();
        await setupTestStripeCustomer(userId);
        await createTestSubscription({
          userId,
          status: 'active',
          tier: 'Standard',
          product: 'prod_standard_12345',
        });

        const caller = createCaller({
          userId,
          role: 'user',
          tier: 'Standard',
          credits: { remaining: 250, limit: 250, resetAt: Date.now() },
        });

        const result = await caller.account.standardFeature();

        expect(result).toMatchObject({
          message: expect.stringContaining('standard subscribers'),
        });
      });

      // Regression: a higher tier must satisfy a lower-tier gate. Pro users
      // were previously denied Standard-gated features by an exact-match check.
      it('allows users with Pro subscription (higher tier inherits)', async () => {
        const userId = createTestUserId();
        await setupTestStripeCustomer(userId);
        await createTestSubscription({
          userId,
          status: 'active',
          tier: 'Pro',
          product: 'prod_pro_12345',
        });

        const caller = createCaller({
          userId,
          role: 'user',
          tier: 'Pro',
          credits: { remaining: 250, limit: 250, resetAt: Date.now() },
        });

        const result = await caller.account.standardFeature();

        expect(result).toMatchObject({
          message: expect.stringContaining('standard subscribers'),
        });
      });
    });

    describe('proFeature', () => {
      it('allows users with Pro subscription', async () => {
        const userId = createTestUserId();
        await setupTestStripeCustomer(userId);
        await createTestSubscription({
          userId,
          status: 'active',
          tier: 'Pro',
          product: 'prod_pro_12345',
        });

        const caller = createCaller({
          userId,
          role: 'user',
          tier: 'Pro',
          credits: { remaining: 250, limit: 250, resetAt: Date.now() },
        });

        const result = await caller.account.proFeature();

        expect(result).toMatchObject({
          message: expect.stringContaining('pro subscribers'),
        });
      });
    });
  });
});
