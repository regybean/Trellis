import { z } from 'zod/v4';

export const ResetRateLimitRequest = z.object({
  userId: z.string().min(1, 'User ID is required'),
});

export const MaxOutRateLimitRequest = z.object({
  userId: z.string().min(1, 'User ID is required'),
});

export const OverrideExpiryRequest = z.object({
  userId: z.string().min(1, 'User ID is required'),
  expiryTimestamp: z
    .number()
    .int()
    .positive('Expiry timestamp must be a positive integer'),
});

export const GetUserRateLimitStatusRequest = z.object({
  userId: z.string().min(1, 'User ID is required'),
});

export const GetUserSubscriptionRequest = z.object({
  userId: z.string().min(1, 'User ID is required'),
});

// Admin-only, localstripe-only: move a user between billing tiers directly
// (no Stripe Checkout). 'Basic' cancels any paid subscription.
export const SetUserTierRequest = z.object({
  userId: z.string().min(1, 'User ID is required'),
  email: z.email('A valid email is required'),
  tier: z.enum(['Basic', 'Standard', 'Pro']),
});

export const GetUserSubscriptionResponse = z.object({
  userId: z.string(),
  subscription: z.union([
    z.object({
      subscriptionId: z.string().nullable(),
      product: z.string().nullable(),
      status: z.string(),
      priceId: z.string().nullable(),
      currentPeriodStart: z.number().int().nullable(),
      currentPeriodEnd: z.number().int().nullable(),
      cancelAtPeriodEnd: z.boolean(),
      paymentMethod: z
        .object({
          brand: z.string().nullable(),
          last4: z.string().nullable(),
        })
        .nullable(),
    }),
    z.object({
      status: z.literal('none'),
    }),
  ]),
});
