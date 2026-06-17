import type { EntitlementsProvider } from '@acme/entitlements';
import { isTierAtLeast } from '@acme/entitlements';

import { credits } from './credits';
import {
  getSubscriptionType,
  getUserSubscriptionFromRedis,
} from './subscriptions';

/**
 * The Stripe/Redis-backed `EntitlementsProvider`: reads the cached Stripe
 * subscription, derives the tier, and reads/decrements the Redis Credit
 * balance. Apps with billing inject this into `createTRPCContext`; it is the
 * adapter side of docs/adr/0006-entitlements-injection-seam.md — the platform
 * substrate depends only on the neutral contract, never on this module.
 */
export const subscriptionsEntitlements: EntitlementsProvider = {
  async resolve(userId) {
    const subscription = await getUserSubscriptionFromRedis(userId);
    const tier = getSubscriptionType(subscription);
    const balance = await credits.read(userId, subscription, tier);
    return { subscription, tier, credits: balance };
  },
  consume(userId, tier, amount) {
    return credits.consume(userId, tier, amount);
  },
  isTierAtLeast,
};
