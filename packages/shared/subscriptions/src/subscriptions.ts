import { z } from 'zod/v4';

import { logger } from '@acme/logger';
import { redis } from '@acme/redis';

import type { SubscriptionCache, SubscriptionTier } from './subscription-cache';
import { env } from './env';
import { SubscriptionCacheSchema } from './subscription-cache';

export async function getUserSubscriptionFromRedis(
  userId: string | null,
): Promise<SubscriptionCache> {
  try {
    const stripeCustomerId = await redis.get(`stripe:user:${userId}`);
    if (!stripeCustomerId) return { status: 'none' } as const;

    const customerDataRaw = await redis.get(
      `stripe:customer:${stripeCustomerId}`,
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
