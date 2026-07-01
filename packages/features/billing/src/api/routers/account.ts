import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import {
  credits,
  getStripeCustomerId,
  getUserSubscriptionFromRedis,
} from '@acme/subscriptions';

import {
  createCheckoutSession,
  createDashboardSession,
  findOrCreateCustomer,
  getProductWithPrice,
  setUserTier,
} from '../../utils/stripe';
import {
  GetUserRateLimitStatusRequest,
  GetUserSubscriptionRequest,
  GetUserSubscriptionResponse,
  MaxOutRateLimitRequest,
  OverrideExpiryRequest,
  ResetRateLimitRequest,
  SetUserTierRequest,
} from '../schemas/account';
import {
  adminProcedure,
  createTRPCRouter,
  protectedProcedure,
  requireTier,
} from '../trpc';

// Input validation
const CheckoutRequest = z.object({
  productId: z.string(),
});

export const accountRouter = createTRPCRouter({
  createCheckoutSession: protectedProcedure
    .input(CheckoutRequest)
    .mutation(async ({ input, ctx }) => {
      // Get user information from context
      const { userId } = ctx.auth;
      const email = ctx.user?.primaryEmailAddress?.emailAddress;

      ctx.telemetry.set({ 'input.productId': input.productId });

      if (!email) {
        ctx.telemetry.event('checkout.failed', { reason: 'no_email' });
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'User does not have a primary email address',
        });
      }

      // Get product and pricing information
      const { defaultPriceId, productId } = await getProductWithPrice(
        input.productId,
        ctx.telemetry,
      );

      // Find existing customer or create new one using userId
      const { customer, isExisting } = await findOrCreateCustomer(
        email,
        userId,
        ctx.telemetry,
      );

      // ALWAYS create a checkout with a stripeCustomerId
      const session = await createCheckoutSession(
        customer,
        defaultPriceId,
        productId,
        ctx.telemetry,
      );

      ctx.telemetry.set({
        'checkout.session_created': true,
        'checkout.is_returning_customer': isExisting,
      });

      // Note: Do not log email addresses - PII concern
      return {
        checkoutTimestamp: session.created,
        customerId: customer.id,
        customerEmail: customer.email,
        isReturningCustomer: isExisting,
        sessionId: session.id,
        checkoutUrl: session.url,
      };
    }),

  createDashboardSession: protectedProcedure.mutation(async ({ ctx }) => {
    // Get user information from context
    const { userId } = ctx.auth;
    const email = ctx.user?.primaryEmailAddress?.emailAddress;

    if (!email) {
      ctx.telemetry.event('dashboard.failed', { reason: 'no_email' });
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'User does not have a primary email address',
      });
    }

    // Get the stripeCustomerId from Redis
    const stripeCustomerId = await getStripeCustomerId(userId);
    if (!stripeCustomerId) {
      ctx.telemetry.event('dashboard.failed', { reason: 'no_customer_id' });
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'No existing Stripe customer found',
      });
    }

    // Create billing portal session - Stripe handles all the logic
    const result = await createDashboardSession(
      stripeCustomerId,
      ctx.telemetry,
    );

    ctx.telemetry.set({ 'dashboard.session_created': true });

    return {
      success: true,
      billingPortalUrl: result.billingPortalUrl,
      message: 'Redirecting to Stripe dashboard for subscription management',
    };
  }),

  getSubscriptionDetails: protectedProcedure.query(({ ctx }) => {
    const { subscription } = ctx;
    const tier = ctx.tier;

    ctx.telemetry.set({
      'subscription.tier': tier,
      'subscription.status': subscription.status,
    });

    if (subscription.status === 'none') {
      return {
        subscription: tier,
        currentPeriodEnd: null,
        currentPeriodStart: null,
        cancelAtPeriodEnd: false,
        status: 'none' as const,
      };
    }

    return {
      subscription: tier,
      currentPeriodEnd: subscription.currentPeriodEnd,
      currentPeriodStart: subscription.currentPeriodStart,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      status: subscription.status,
    };
  }),

  getCreditUsage: protectedProcedure.query(({ ctx }) => {
    const { credits } = ctx;

    ctx.telemetry.set({
      'credits.remaining': credits.remaining,
      'credits.limit': credits.limit,
      'credits.usage_percentage': Math.round(
        ((credits.limit - credits.remaining) / credits.limit) * 100,
      ),
    });

    return {
      remaining: credits.remaining,
      limit: credits.limit,
      resetAt: credits.resetAt,
      usagePercentage: Math.round(
        ((credits.limit - credits.remaining) / credits.limit) * 100,
      ),
    };
  }),

  resetUserRateLimit: adminProcedure
    .input(ResetRateLimitRequest)
    .mutation(async ({ input, ctx }) => {
      const { userId } = input;

      ctx.telemetry.set({ 'admin.target_user_id': userId });

      try {
        const { tier, limit, resetAt } = await credits.reset(userId);

        ctx.telemetry.set({
          'admin.action': 'rate_limit_reset',
          'admin.new_credit_count': limit,
          'admin.tier': tier,
        });

        return {
          message: `Successfully reset rate limit for user ${userId}`,
          userId,
          newCreditCount: limit,
          tier,
          resetAt,
        };
      } catch (error) {
        ctx.telemetry.set({ 'admin.action_failed': true });

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to reset rate limit for user ${userId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  /**
   * Max out (exhaust) a user's rate limit - sets remaining tokens to 0
   */
  maxOutUserRateLimit: adminProcedure
    .input(MaxOutRateLimitRequest)
    .mutation(async ({ input, ctx }) => {
      const { userId } = input;

      ctx.telemetry.set({ 'admin.target_user_id': userId });

      try {
        const { tier, previousLimit, resetAt } = await credits.maxOut(userId);

        ctx.telemetry.set({
          'admin.action': 'rate_limit_maxout',
          'admin.previous_limit': previousLimit,
          'admin.tier': tier,
        });

        return {
          message: `Successfully maxed out rate limit for user ${userId}`,
          userId,
          newCreditCount: 0,
          previousLimit,
          tier,
          resetAt,
        };
      } catch (error) {
        ctx.telemetry.set({ 'admin.action_failed': true });

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to max out rate limit for user ${userId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  /**
   * Override the expiry date of a user's rate limit
   */
  overrideUserRateLimitExpiry: adminProcedure
    .input(OverrideExpiryRequest)
    .mutation(async ({ input, ctx }) => {
      const { userId, expiryTimestamp } = input;

      ctx.telemetry.set({
        'admin.target_user_id': userId,
        'admin.new_expiry_timestamp': expiryTimestamp,
      });

      const { tier, keyExisted, previousExpiryTimestamp } =
        await credits.overrideExpiry(userId, expiryTimestamp);

      ctx.telemetry.set({
        'admin.action': 'rate_limit_expiry_override',
        'admin.created_key': !keyExisted,
        'admin.key_existed': keyExisted,
        'admin.tier': tier,
      });

      return {
        message: `Successfully overrode expiry for user ${userId}`,
        userId,
        newExpiryTimestamp: expiryTimestamp,
        previousExpiryTimestamp,
      };
    }),

  /**
   * Get the current rate limit status for a user
   */
  getUserRateLimitStatus: adminProcedure
    .input(GetUserRateLimitStatusRequest)
    .query(async ({ input, ctx }) => {
      const { userId } = input;

      ctx.telemetry.set({ 'admin.target_user_id': userId });

      const { tier, remaining, limit, resetAt, keyExists } =
        await credits.status(userId);

      ctx.telemetry.set({
        'admin.query': 'rate_limit_status',
        'admin.tier': tier,
        'admin.key_exists': keyExists,
        'admin.remaining_credits': remaining,
      });

      return {
        userId,
        tier,
        remaining,
        limit,
        resetAt,
        keyExists,
      };
    }),

  /**
   * Get user subscription details
   */
  getUserSubscription: adminProcedure
    .input(GetUserSubscriptionRequest)
    .output(GetUserSubscriptionResponse)
    .query(async ({ input, ctx }) => {
      const { userId } = input;

      ctx.telemetry.set({ 'admin.target_user_id': userId });

      const subscription = await getUserSubscriptionFromRedis(userId);

      ctx.telemetry.set({
        'admin.query': 'user_subscription',
        'admin.subscription_status': subscription.status,
      });

      return {
        userId,
        subscription,
      };
    }),

  /**
   * Set a user's billing tier directly (localstripe dev only — no Checkout).
   */
  setUserTier: adminProcedure
    .input(SetUserTierRequest)
    .mutation(async ({ input, ctx }) => {
      const { userId, email, tier } = input;

      ctx.telemetry.set({
        'admin.target_user_id': userId,
        'admin.requested_tier': tier,
      });

      const subscription = await setUserTier(
        { userId, email, tier },
        ctx.telemetry,
      );

      return {
        message: `Successfully set ${userId} to ${tier}`,
        userId,
        tier,
        status: subscription.status,
      };
    }),

  // Example Standard-or-higher feature (Standard and Pro both pass)
  standardFeature: protectedProcedure
    .use(requireTier('Standard'))
    .query(({ ctx }) => {
      return {
        message: 'This feature is available to standard subscribers!',
        subscriptionInfo: ctx.subscription,
      };
    }),

  // Example Pro-only feature
  proFeature: protectedProcedure.use(requireTier('Pro')).query(({ ctx }) => {
    return {
      message: 'This feature is available to pro subscribers!',
      subscriptionInfo: ctx.subscription,
    };
  }),
});
