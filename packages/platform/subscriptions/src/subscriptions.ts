import { z } from 'zod/v4';

import { logger } from '@acme/logger';
import { nsKey, redis } from '@acme/redis';

import type { SubscriptionCache, SubscriptionTier } from './subscription-cache';
import { env } from './env';
import { SubscriptionCacheSchema } from './subscription-cache';

/**
 * The Stripe cache keys, namespaced per app. The single home for the
 * `stripe:user:<id>` (userId -> Stripe customer id) and
 * `stripe:customer:<id>` (cached subscription) key formats: every caller —
 * this module, `@acme/billing`'s webhook sync, the account router — builds keys
 * through these, so the prefix can never be forgotten and the format lives once.
 */
export const stripeUserKey = (userId: string | null) =>
  nsKey('stripe', 'user', String(userId));
export const stripeCustomerKey = (customerId: string) =>
  nsKey('stripe', 'customer', customerId);

export async function getUserSubscriptionFromRedis(
  userId: string | null,
): Promise<SubscriptionCache> {
  try {
    const stripeCustomerId = await redis.get(stripeUserKey(userId));
    if (!stripeCustomerId) return { status: 'none' } as const;

    const customerDataRaw = await redis.get(
      stripeCustomerKey(stripeCustomerId),
    );
    if (!customerDataRaw) return { status: 'none' } as const;

    const parsed = SubscriptionCacheSchema.safeParse(
      JSON.parse(customerDataRaw),
    );
    if (!parsed.success) {
      logger.warn(
        { validationError: z.treeifyError(parsed.error) },
        'Invalid subscription cache shape, resetting to none',
      );
      return { status: 'none' } as const;
    }
    return parsed.data;
  } catch (error) {
    logger.error({ error }, 'Error getting user subscription from Redis');
    return { status: 'none' } as const;
  }
}

export function getSubscriptionType(
  subscription: SubscriptionCache,
): SubscriptionTier {
  if (subscription.status !== 'active') return 'Basic';
  if (subscription.product === env.NEXT_PUBLIC_STRIPE_STANDARD_PLAN_ID)
    return 'Standard';
  if (subscription.product === env.NEXT_PUBLIC_STRIPE_PRO_PLAN_ID) return 'Pro';
  return 'Basic';
}
