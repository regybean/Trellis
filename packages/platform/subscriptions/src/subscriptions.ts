import { z } from 'zod/v4';

import { logger } from '@acme/logger';
import { nsKey, redis } from '@acme/redis';

import type { SubscriptionCache, SubscriptionTier } from './subscription-cache';
import { env } from './env';
import { SubscriptionCacheSchema } from './subscription-cache';

/**
 * The Stripe cache keys, namespaced per app. The single home for the
 * `stripe:user:<id>` (userId -> Stripe customer id) and
 * `stripe:customer:<id>` (cached subscription) key formats. These are
 * **internal** to this package: the key shape is a Redis-storage detail that
 * must not leak past the seam, so callers reach the values through the
 * functions below (`getStripeCustomerId`, `setStripeCustomerId`,
 * `getUserSubscriptionFromRedis`, `setSubscriptionCache`) rather than building
 * keys themselves. A replacement store can change the layout without touching
 * any caller.
 */
const stripeUserKey = (userId: string | null) =>
  nsKey('stripe', 'user', String(userId));
const stripeCustomerKey = (customerId: string) =>
  nsKey('stripe', 'customer', customerId);

/**
 * Resolve a user's Stripe customer id from Redis (the `stripe:user:<id>`
 * mapping), or `null` when the user has no customer yet. Hides the key shape.
 */
export async function getStripeCustomerId(
  userId: string | null,
): Promise<string | null> {
  return redis.get(stripeUserKey(userId));
}

/**
 * Persist the userId -> Stripe customer id mapping. Owned by the billing
 * feature's customer-creation flow; the key shape stays internal here.
 */
export async function setStripeCustomerId(
  userId: string,
  customerId: string,
): Promise<void> {
  await redis.set(stripeUserKey(userId), customerId);
}

/**
 * Persist the cached subscription for a customer (the `stripe:customer:<id>`
 * value). Serialization and key shape are owned here; callers pass the typed
 * cache. Written by `@acme/billing`'s webhook sync.
 */
export async function setSubscriptionCache(
  customerId: string,
  cache: SubscriptionCache,
): Promise<void> {
  await redis.set(stripeCustomerKey(customerId), JSON.stringify(cache));
}

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
