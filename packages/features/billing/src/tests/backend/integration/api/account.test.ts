/**
 * Account Router Tests
 *
 * Testing philosophy:
 * - Test auth/validation ONCE since all procedures use the same middleware
 * - Focus on BUSINESS LOGIC with real Redis scenarios
 * - Test with "zero, one, many" pattern for data
 * - Use real Redis via testcontainers or docker-compose
 * - Mock only external services (Stripe, Clerk, Otel)
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import { beforeEach, describe, expect, it } from 'vitest';

import type { TestContextOptions } from '../../utils/test-context';
import { appRouter } from '../../../../api/root';
import { BillingErrorCode } from '../../../../utils/stripe-errors';
import {
  createTestSubscription,
  createTestUserId,
  setupTestStripeCustomer,
} from '../../utils/fixtures';
import { cleanupTestData, createTestContext } from '../../utils/test-context';

// Helper to create a tRPC caller with the given context options
function createCaller(opts: TestContextOptions) {
  const ctx = createTestContext(opts);
  return appRouter.createCaller(ctx);
}

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
    it('creates checkout session for authenticated user with email', async () => {
      const userId = createTestUserId();
      const caller = createCaller({
        userId,
        role: 'user',
        tier: 'Basic',
        credits: { remaining: 250, limit: 250, resetAt: Date.now() },
      });

      const result = await caller.account.createCheckoutSession({
        productId: 'prod_12345',
      });

      expect(result).toMatchObject({
        sessionId: 'cs_12345',
        checkoutUrl: 'https://checkout.stripe.com/test',
        customerId: 'cus_12345',
      });
    });
  });

  // ==========================================================================
  // BUSINESS LOGIC: createDashboardSession
  // ==========================================================================
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

  // ==========================================================================
  // ADMIN: setUserTier (localstripe dev)
  // ==========================================================================
  describe('setUserTier', () => {
    it('sets a target user to a paid tier', async () => {
      const targetUserId = createTestUserId('target');
      const adminUserId = createTestUserId('admin');

      const caller = createCaller({
        userId: adminUserId,
        role: 'admin',
        tier: 'Basic',
        credits: { remaining: 250, limit: 250, resetAt: Date.now() },
      });

      const result = await caller.account.setUserTier({
        userId: targetUserId,
        email: 'target@example.com',
        tier: 'Pro',
      });

      expect(result).toMatchObject({
        userId: targetUserId,
        tier: 'Pro',
        status: 'active',
        message: expect.stringContaining('Successfully set'),
      });
    });

    it('rejects an invalid email', async () => {
      const caller = createCaller({
        userId: createTestUserId('admin'),
        role: 'admin',
        tier: 'Basic',
        credits: { remaining: 250, limit: 250, resetAt: Date.now() },
      });

      await expect(
        caller.account.setUserTier({
          userId: createTestUserId('target'),
          email: 'not-an-email',
          tier: 'Standard',
        }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });
  });

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
