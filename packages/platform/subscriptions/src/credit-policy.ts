import type { SubscriptionCache, SubscriptionTier } from './subscription-cache';
import { env } from './env';

/**
 * The pure Credit policy: per-tier limits and the billing-window that bounds a
 * balance. No Redis, no I/O — just the numbers and dates the storage layer in
 * `credits.ts` reads and writes. Split out so it can be unit-tested in isolation
 * (`tests/backend/unit`) while the storage operations are tested against real Redis
 * (`tests/backend/integration/service`).
 *
 * The tier limits are authored config (@acme/env ADR 0001): resolved from the
 * deploy-target profile in `env.ts`, where a same-named variable can retune them
 * per deploy.
 */

/** The full monthly Credit limit for a tier, falling back for unknown tiers. */
export function creditLimitFor(tier: SubscriptionTier) {
  return env.CREDIT_LIMITS[tier] ?? env.DEFAULT_LIMIT;
}

/**
 * The `{ start, end }` Unix-timestamp window credits live in. Active
 * subscriptions use the Stripe period; everything else falls back to the
 * current calendar month. `end` is used as the Redis expiry, so credits reset
 * automatically at the window boundary.
 */
export function billingWindow(subscription: SubscriptionCache) {
  if (
    subscription.status !== 'active' ||
    !('currentPeriodStart' in subscription) ||
    !subscription.currentPeriodStart ||
    !subscription.currentPeriodEnd
  ) {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
      999,
    );
    return {
      start: Math.floor(start.getTime() / 1000),
      end: Math.floor(end.getTime() / 1000),
    };
  }
  return {
    start: subscription.currentPeriodStart,
    end: subscription.currentPeriodEnd,
  };
}
