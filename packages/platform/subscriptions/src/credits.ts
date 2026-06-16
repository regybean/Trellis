import { redis } from '@acme/redis';

import type { SubscriptionCache, SubscriptionTier } from './subscription-cache';
import {
  getSubscriptionType,
  getUserSubscriptionFromRedis,
} from './subscriptions';

/**
 * The one home for the Credit balance policy: the Redis key format, the
 * per-tier limits, the billing-window expiry, and every credit mutation. The
 * key format and limits are module-private — callers (the rate-limit
 * middleware, the billing admin router) invoke operations and never assemble
 * `credits:{userId}:{tier}` themselves.
 */

const DEFAULT_LIMIT = 250;

const CREDIT_LIMITS = new Map<SubscriptionTier, number>([
  ['Basic', 250],
  ['Standard', 350],
  ['Pro', 1600],
]);

function creditLimitFor(tier: SubscriptionTier) {
  return CREDIT_LIMITS.get(tier) ?? DEFAULT_LIMIT;
}

function creditKey(userId: string | null, tier: SubscriptionTier) {
  return `credits:${userId}:${tier}`;
}

/**
 * The `{ start, end }` Unix-timestamp window credits live in. Active
 * subscriptions use the Stripe period; everything else falls back to the
 * current calendar month. `end` is the Redis expiry, so credits reset
 * automatically.
 */
function billingWindow(subscription: SubscriptionCache) {
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

/**
 * Reads the current Credit balance, eagerly creating the key with the full
 * limit (and the billing-window expiry, atomically) when it does not yet
 * exist. Takes the already-assembled subscription + tier because its only
 * caller — the tRPC context — has them on hand.
 */
async function read(
  userId: string | null,
  subscription: SubscriptionCache,
  tier: SubscriptionTier,
) {
  const limit = creditLimitFor(tier);
  const window = billingWindow(subscription);
  const key = creditKey(userId, tier);
  const current = await redis.get(key);
  if (current === null) {
    await redis.set(key, String(limit), { EXAT: window.end });
    return { remaining: limit, limit, resetAt: window.end };
  }
  const remaining = Math.max(0, Number.parseInt(current, 10) || 0);
  const ttl = await redis.ttl(key);
  const resetAt = ttl > 0 ? Math.floor(Date.now() / 1000) + ttl : window.end;
  return { remaining, limit, resetAt };
}

/**
 * Decrements the Credit balance by `amount`. The caller (the rate-limit
 * middleware) already holds the tier and has guarded `remaining >= amount`.
 */
async function consume(userId: string, tier: SubscriptionTier, amount: number) {
  await redis.decrBy(creditKey(userId, tier), amount);
}

/**
 * Resets a user's Credit balance to the full limit for their tier, atomically
 * setting the value and the billing-window expiry in one command (no immortal
 * key on a partial failure). Fetches the subscription itself — admin callers
 * target an arbitrary user, not the request's own context.
 */
async function reset(userId: string) {
  const subscription = await getUserSubscriptionFromRedis(userId);
  const tier = getSubscriptionType(subscription);
  const limit = creditLimitFor(tier);
  const window = billingWindow(subscription);
  await redis.set(creditKey(userId, tier), String(limit), {
    EXAT: window.end,
  });
  return { tier, limit, resetAt: window.end };
}

/**
 * Exhausts a user's Credit balance (sets it to 0), atomically with the
 * billing-window expiry.
 */
async function maxOut(userId: string) {
  const subscription = await getUserSubscriptionFromRedis(userId);
  const tier = getSubscriptionType(subscription);
  const previousLimit = creditLimitFor(tier);
  const window = billingWindow(subscription);
  await redis.set(creditKey(userId, tier), '0', { EXAT: window.end });
  return { tier, previousLimit, resetAt: window.end };
}

/**
 * Overrides the expiry of a user's Credit balance. When the key already
 * exists, only its expiry moves; when it is missing, it is created with the
 * full limit and the new expiry in one atomic command.
 */
async function overrideExpiry(userId: string, expiresAt: number) {
  const subscription = await getUserSubscriptionFromRedis(userId);
  const tier = getSubscriptionType(subscription);
  const key = creditKey(userId, tier);
  // ttl: -2 missing, -1 exists-without-expiry, >0 seconds remaining.
  const ttl = await redis.ttl(key);
  const keyExisted = ttl !== -2;
  const previousExpiryTimestamp =
    ttl > 0 ? Math.floor(Date.now() / 1000) + ttl : null;
  await (keyExisted
    ? redis.expireAt(key, expiresAt)
    : redis.set(key, String(creditLimitFor(tier)), { EXAT: expiresAt }));
  return { tier, keyExisted, previousExpiryTimestamp };
}

/**
 * Reports a user's current Credit balance plus whether the Redis key is
 * materialised — for the admin status view.
 */
async function status(userId: string) {
  const subscription = await getUserSubscriptionFromRedis(userId);
  const tier = getSubscriptionType(subscription);
  const key = creditKey(userId, tier);
  const { remaining, limit, resetAt } = await read(userId, subscription, tier);
  const keyExists = (await redis.exists(key)) === 1;
  return { tier, remaining, limit, resetAt, keyExists };
}

export const credits = {
  read,
  consume,
  reset,
  maxOut,
  overrideExpiry,
  status,
};
