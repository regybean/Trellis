import { beforeEach, describe, expect, it } from 'vitest';

import { nsKey, redis } from '@acme/redis';
import { flushTestDb } from '@acme/redis/testing';

import type {
  SubscriptionCache,
  SubscriptionTier,
} from '../../../subscription-cache';
import { credits } from '../../../credits';
import {
  setStripeCustomerId,
  setSubscriptionCache,
} from '../../../subscriptions';

/**
 * Service tests for the Credit storage layer against a REAL Redis (the isolated
 * logical DB from this suite's vitest config). No `@acme/redis` mock — per ADR
 * 0014 in-repo infra is exercised for real. The pure limit/window policy is
 * covered in `tests/domain/credit-policy.test.ts`.
 *
 * Tier is controlled the way production sets it: by seeding the Stripe
 * subscription cache in Redis (`setStripeCustomerId` + `setSubscriptionCache`),
 * which `getUserSubscriptionFromRedis` + `getSubscriptionType` then resolve — the
 * product ids map to tiers via the staticTestEnv `NEXT_PUBLIC_STRIPE_*_PLAN_ID`.
 */

const USER = 'user_1';

const keyFor = (tier: SubscriptionTier) => nsKey('credits', USER, tier);
const now = () => Math.floor(Date.now() / 1000);

/** Seed a paid subscription so `credits.*` resolves the given tier for USER. */
async function seedTier(userId: string, tier: 'Standard' | 'Pro') {
  const customerId = `cus_${userId}`;
  await setStripeCustomerId(userId, customerId);
  const product =
    tier === 'Standard' ? 'price_standard_test' : 'price_pro_test';
  const cache: SubscriptionCache = {
    status: 'active',
    subscriptionId: 'sub_test',
    product,
    priceId: 'price_line_test',
    currentPeriodStart: now(),
    currentPeriodEnd: now() + 86_400 * 30,
    cancelAtPeriodEnd: false,
    paymentMethod: null,
  };
  await setSubscriptionCache(customerId, cache);
}

beforeEach(async () => {
  await flushTestDb();
});

describe('credit key + tier limits', () => {
  it('uses the canonical credits:{userId}:{tier} key format', async () => {
    await credits.reset(USER);
    expect(await redis.exists(keyFor('Basic'))).toBe(1);
  });

  it.each([
    ['Standard', 350],
    ['Pro', 1600],
  ] as const)('resets %s to its limit of %i', async (tier, limit) => {
    await seedTier(USER, tier);
    const result = await credits.reset(USER);
    expect(result).toMatchObject({ tier, limit });
    expect(await redis.get(keyFor(tier))).toBe(String(limit));
  });

  it('resets Basic (no subscription) to the default limit', async () => {
    const result = await credits.reset(USER);
    expect(result).toMatchObject({ tier: 'Basic', limit: 250 });
    expect(await redis.get(keyFor('Basic'))).toBe('250');
  });
});

describe('read (eager init)', () => {
  it('creates the key at the full limit with an expiry when missing', async () => {
    const result = await credits.read(USER, { status: 'none' }, 'Basic');

    expect(result).toMatchObject({ remaining: 250, limit: 250 });
    // No immortal key: the eager-init write carries an expiry.
    expect(await redis.ttl(keyFor('Basic'))).toBeGreaterThan(0);
    expect(result.resetAt).toBeGreaterThan(now());
  });

  it('returns the stored balance without re-initialising', async () => {
    await redis.set(keyFor('Basic'), '42', { EXAT: now() + 100 });

    const result = await credits.read(USER, { status: 'none' }, 'Basic');
    expect(result.remaining).toBe(42);
  });

  it('clamps a negative stored balance to zero', async () => {
    await redis.set(keyFor('Basic'), '-5');
    const result = await credits.read(USER, { status: 'none' }, 'Basic');
    expect(result.remaining).toBe(0);
  });
});

describe('consume', () => {
  it('decrements the balance by the given amount', async () => {
    await redis.set(keyFor('Basic'), '10');
    await credits.consume(USER, 'Basic', 3);
    expect(await redis.get(keyFor('Basic'))).toBe('7');
  });
});

describe('reset / maxOut carry an expiry (no immortal key)', () => {
  it('reset writes the full limit with an expiry', async () => {
    await credits.reset(USER);
    expect(await redis.get(keyFor('Basic'))).toBe('250');
    expect(await redis.ttl(keyFor('Basic'))).toBeGreaterThan(0);
  });

  it('maxOut writes zero with an expiry and reports the previous limit', async () => {
    await seedTier(USER, 'Pro');
    const result = await credits.maxOut(USER);
    expect(result).toMatchObject({ tier: 'Pro', previousLimit: 1600 });
    expect(await redis.get(keyFor('Pro'))).toBe('0');
    expect(await redis.ttl(keyFor('Pro'))).toBeGreaterThan(0);
  });
});

describe('overrideExpiry', () => {
  it('moves only the expiry when the key already exists', async () => {
    await redis.set(keyFor('Basic'), '99', { EXAT: now() + 100 });
    const newExpiry = now() + 5000;

    const result = await credits.overrideExpiry(USER, newExpiry);

    expect(result.keyExisted).toBe(true);
    expect(result.previousExpiryTimestamp).not.toBeNull();
    expect(await redis.get(keyFor('Basic'))).toBe('99');
    // ttl now reflects the new (further) expiry.
    expect(await redis.ttl(keyFor('Basic'))).toBeGreaterThan(1000);
  });

  it('creates the key with the full limit and new expiry when missing', async () => {
    const newExpiry = now() + 5000;

    const result = await credits.overrideExpiry(USER, newExpiry);

    expect(result.keyExisted).toBe(false);
    expect(result.previousExpiryTimestamp).toBeNull();
    expect(await redis.get(keyFor('Basic'))).toBe('250');
    expect(await redis.ttl(keyFor('Basic'))).toBeGreaterThan(1000);
  });
});

describe('status', () => {
  it('reports the balance plus whether the key is materialised', async () => {
    const result = await credits.status(USER);
    expect(result).toMatchObject({
      tier: 'Basic',
      remaining: 250,
      limit: 250,
      keyExists: true,
    });
  });
});
