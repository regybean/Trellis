import type { EntitlementsProvider } from '@acme/entitlements';
import { isTierAtLeast } from '@acme/entitlements';

import type { PlanIds } from './subscriptions';
import { credits } from './credits';
import {
  getSubscriptionType,
  getUserSubscriptionFromRedis,
} from './subscriptions';

/**
 * Build the Stripe/Redis-backed `EntitlementsProvider`: reads the cached Stripe
 * subscription, derives the tier (via the injected plan IDs), and
 * reads/decrements the Redis Credit balance. Apps with billing inject the result
 * into `createTRPCContext`; it is the adapter side of
 * docs/adr/0006-entitlements-injection-seam.md — the platform substrate depends
 * only on the neutral contract, never on this module.
 *
 * A factory (not a const) because the product→tier mapping now needs the
 * `billingConfig` plan IDs, resolved once at the app edge and injected here
 * (ADR 0026) rather than read from `process.env`. The options object is the
 * extension point for further per-deploy billing policy (e.g. credit limits).
 */
export function createSubscriptionsEntitlements(
  planIds: PlanIds,
): EntitlementsProvider {
  return {
    async resolve(userId) {
      const subscription = await getUserSubscriptionFromRedis(userId);
      const tier = getSubscriptionType(subscription, planIds);
      const balance = await credits.read(userId, subscription, tier);
      return { subscription, tier, credits: balance };
    },
    consume(userId, tier, amount) {
      return credits.consume(userId, tier, amount);
    },
    refund(userId, tier, amount) {
      return credits.refund(userId, tier, amount);
    },
    isTierAtLeast,
  };
}
