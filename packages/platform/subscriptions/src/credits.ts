import { nsKey, redis } from '@acme/redis';

import type { SubscriptionCache, SubscriptionTier } from './subscription-cache';
import { billingWindow, creditLimitFor } from './credit-policy';
import {
  getSubscriptionType,
  getUserSubscriptionFromRedis,
} from './subscriptions';

/**
 * The storage layer for the Credit balance policy: the Redis key format and
 * every credit mutation. The per-tier limits and billing window are the pure
 * policy in `credit-policy.ts`. The key format is module-private — callers (the
 * rate-limit middleware, the billing admin router) invoke operations and never
 * assemble `credits:{userId}:{tier}` themselves.
 */

function creditKey(userId: string | null, tier: SubscriptionTier) {
  return nsKey('credits', String(userId), tier);
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
