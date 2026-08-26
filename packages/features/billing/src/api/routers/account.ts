import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import {
  credits,
  getStripeCustomerId,
  getUserSubscriptionFromRedis,
} from '@acme/subscriptions';

import {
  billingError,
  BillingErrorCode,
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

/**
 * The app's own public origin, threaded into the context at the app edge
 * (`ctx.origin`) and combined with the config-owned checkout paths to build the
 * absolute Stripe redirect URLs (ADR 0026 follow-up). Absent only in a build
 * that mounts billing without threading it — surface that as a billing error
 * rather than passing `undefined` into `new URL`.
 */
function requireOrigin(origin: string | undefined): string {
  if (!origin) {
    throw billingError(
      BillingErrorCode.MissingOrigin,
      'INTERNAL_SERVER_ERROR',
      'Checkout requires the app origin to be threaded into the tRPC context',
    );
  }
  return origin;
}

export const accountRouter = createTRPCRouter({
  createCheckoutSession: protectedProcedure
    .input(CheckoutRequest)
    .mutation(async ({ input, ctx }) => {
      // Get user information from context
      const { id: userId, primaryEmailAddress } = ctx.session.user;
      const email = primaryEmailAddress?.emailAddress;

      if (!email) {
        throw billingError(
          BillingErrorCode.NoEmail,
          'BAD_REQUEST',
          'User does not have a primary email address',
        );
      }

      // Get product and pricing information
      const { defaultPriceId, productId } = await getProductWithPrice(
        input.productId,
      );

      // Find existing customer or create new one using userId
      const { customer, isExisting } = await findOrCreateCustomer(
        email,
        userId,
      );

      // ALWAYS create a checkout with a stripeCustomerId
      const session = await createCheckoutSession(
        customer,
        defaultPriceId,
        productId,
        requireOrigin(ctx.origin),
      );

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
    const { id: userId, primaryEmailAddress } = ctx.session.user;
    const email = primaryEmailAddress?.emailAddress;

    if (!email) {
      throw billingError(
        BillingErrorCode.NoEmail,
        'BAD_REQUEST',
        'User does not have a primary email address',
      );
    }

    // Get the stripeCustomerId from Redis
    const stripeCustomerId = await getStripeCustomerId(userId);
    if (!stripeCustomerId) {
      throw billingError(
        BillingErrorCode.NoCustomer,
        'BAD_REQUEST',
        'No existing Stripe customer found',
      );
    }

    // Create billing portal session - Stripe handles all the logic
    const result = await createDashboardSession(
      stripeCustomerId,
      requireOrigin(ctx.origin),
    );

    return {
      success: true,
      billingPortalUrl: result.billingPortalUrl,
      message: 'Redirecting to Stripe dashboard for subscription management',
    };
  }),

  getSubscriptionDetails: protectedProcedure.query(({ ctx }) => {
    const { subscription } = ctx;
    const tier = ctx.tier;

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

      try {
        // Resolve the target user's subscription + tier through the injected
        // entitlements provider (which closes over the `billingConfig` plan IDs,
        // ADR 0026) rather than reading them here.
        const { subscription, tier } = await ctx.entitlements.resolve(userId);
        const { limit, resetAt } = await credits.reset(
          userId,
          subscription,
          tier,
        );

        return {
          message: `Successfully reset rate limit for user ${userId}`,
          userId,
          newCreditCount: limit,
          tier,
          resetAt,
        };
      } catch (error) {
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

      try {
        const { subscription, tier } = await ctx.entitlements.resolve(userId);
        const { previousLimit, resetAt } = await credits.maxOut(
          userId,
          subscription,
          tier,
        );

        return {
          message: `Successfully maxed out rate limit for user ${userId}`,
          userId,
          newCreditCount: 0,
          previousLimit,
          tier,
          resetAt,
        };
      } catch (error) {
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

      const { tier } = await ctx.entitlements.resolve(userId);
      const { previousExpiryTimestamp } = await credits.overrideExpiry(
        userId,
        tier,
        expiryTimestamp,
      );

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

      const { subscription, tier } = await ctx.entitlements.resolve(userId);
      const { remaining, limit, resetAt, keyExists } = await credits.status(
        userId,
        subscription,
        tier,
      );

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
    .query(async ({ input }) => {
      const { userId } = input;

      const subscription = await getUserSubscriptionFromRedis(userId);

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
    .mutation(async ({ input }) => {
      const { userId, email, tier, productId } = input;

      const subscription = await setUserTier({
        userId,
        email,
        tier,
        productId,
      });

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
