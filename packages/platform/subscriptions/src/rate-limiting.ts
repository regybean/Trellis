import { redis } from '@acme/redis';

import type { SubscriptionCache, SubscriptionTier } from './subscription-cache';

const CREDIT_LIMITS = new Map<SubscriptionTier, number>([
  ['Basic', 250],
  ['Standard', 350],
  ['Pro', 1600],
]);

export function getCreditLimit(tier: SubscriptionTier): number {
  return CREDIT_LIMITS.get(tier) ?? 250;
}

const TIER_RANK = new Map<SubscriptionTier, number>([
  ['Basic', 0],
  ['Standard', 1],
  ['Pro', 2],
]);

/**
 * Tests the tier ordering `Basic < Standard < Pro`: `true` when `tier` is at
 * least `minTier`. The single source of truth for hierarchical tier-gating
 * (see `requireTier` in `@acme/trpc`).
 */
export function isTierAtLeast(
  tier: SubscriptionTier,
  minTier: SubscriptionTier,
): boolean {
  return (TIER_RANK.get(tier) ?? 0) >= (TIER_RANK.get(minTier) ?? 0);
}

export function getBillingWindow(subscription: SubscriptionCache): {
  start: number;
  end: number;
} {
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

export async function getCredits(
  userId: string | null,
  subscription: SubscriptionCache,
  tier: SubscriptionTier,
) {
  const limit = getCreditLimit(tier);
  const window = getBillingWindow(subscription);
  const key = `credits:${userId}:${tier}`;
  const nowVal = await redis.get(key);
  if (nowVal === null) {
    await redis.set(key, String(limit));
    await redis.expireAt(key, window.end);
    return { remaining: limit, limit, resetAt: window.end };
  }
  const remaining = Math.max(0, Number.parseInt(nowVal, 10) || 0);
  const ttl = await redis.ttl(key);
  const resetAt = ttl > 0 ? Math.floor(Date.now() / 1000) + ttl : window.end;
  return { remaining, limit, resetAt };
}
