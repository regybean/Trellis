import { z } from 'zod/v4';

const SubscriptionStatus = z.enum([
  'active',
  'past_due',
  'unpaid',
  'canceled',
  'incomplete',
  'incomplete_expired',
  'trialing',
  'paused',
]);

export const SubscriptionCacheSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('none') }),
  z.object({
    status: SubscriptionStatus,
    subscriptionId: z.string().nullable(),
    product: z.string().nullable(),
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
]);

export type SubscriptionCache = z.infer<typeof SubscriptionCacheSchema>;

export type SubscriptionTier = 'Basic' | 'Standard' | 'Pro';
