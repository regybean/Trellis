import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  SubscriptionCache,
  SubscriptionTier,
} from '../subscription-cache';
import { credits } from '../credits';

/**
 * In-memory stand-in for the Redis singleton, modelling only the surface the
 * credit policy uses. Tracks the per-key expiry so the "no immortal key"
 * invariant (every credit write carries an expiry) is assertable.
 */
const store = vi.hoisted(() => ({
  map: new Map<string, { value: string; expireAt: number | null }>(),
}));

vi.mock('@acme/redis', () => ({
  redis: {
    get: vi.fn((key: string) =>
      Promise.resolve(store.map.get(key)?.value ?? null),
    ),
    set: vi.fn((key: string, value: string, opts?: { EXAT?: number }) => {
      store.map.set(key, { value, expireAt: opts?.EXAT ?? null });
      return Promise.resolve('OK');
    }),
    ttl: vi.fn((key: string) => {
      const entry = store.map.get(key);
      if (!entry) return Promise.resolve(-2);
      if (entry.expireAt === null) return Promise.resolve(-1);
      return Promise.resolve(entry.expireAt - Math.floor(Date.now() / 1000));
    }),
    decrBy: vi.fn((key: string, amount: number) => {
      const entry = store.map.get(key);
      const next = (entry ? Number.parseInt(entry.value, 10) : 0) - amount;
      store.map.set(key, {
        value: String(next),
        expireAt: entry?.expireAt ?? null,
      });
      return Promise.resolve(next);
    }),
    expireAt: vi.fn((key: string, timestamp: number) => {
      const entry = store.map.get(key);
      if (!entry) return Promise.resolve(false);
      entry.expireAt = timestamp;
      return Promise.resolve(true);
    }),
    exists: vi.fn((key: string) => Promise.resolve(store.map.has(key) ? 1 : 0)),
  },
  // Mirror the real nsKey (colon-joined; tests run with an empty namespace).
  nsKey: (...parts: string[]) => parts.join(':'),
}));

const subs = vi.hoisted(() => ({
  subscription: { status: 'none' } as SubscriptionCache,
  tier: 'Basic' as SubscriptionTier,
}));

vi.mock('../subscriptions', () => ({
  getUserSubscriptionFromRedis: vi.fn(() => Promise.resolve(subs.subscription)),
  getSubscriptionType: vi.fn(() => subs.tier),
}));

const USER = 'user_1';

function keyFor(tier: SubscriptionTier) {
  return `credits:${USER}:${tier}`;
}

beforeEach(() => {
  store.map.clear();
  subs.subscription = { status: 'none' } as SubscriptionCache;
  subs.tier = 'Basic';
});

describe('credit key + tier limits', () => {
  it('uses the canonical credits:{userId}:{tier} key format', async () => {
    await credits.reset(USER);
    expect([...store.map.keys()]).toEqual(['credits:user_1:Basic']);
  });

  it.each([
    ['Basic', 250],
    ['Standard', 350],
    ['Pro', 1600],
  ] as const)('resets %s to its limit of %i', async (tier, limit) => {
    subs.tier = tier;
    const result = await credits.reset(USER);
    expect(result).toMatchObject({ tier, limit });
    expect(store.map.get(keyFor(tier))?.value).toBe(String(limit));
  });

  it('falls back to the default limit for an unknown tier', async () => {
    subs.tier = 'Mystery' as SubscriptionTier;
    const result = await credits.reset(USER);
    expect(result.limit).toBe(250);
  });
});

describe('read (eager init)', () => {
  it('creates the key at the full limit with an expiry when missing', async () => {
    const result = await credits.read(USER, subs.subscription, 'Basic');

    expect(result).toMatchObject({ remaining: 250, limit: 250 });
    const entry = store.map.get(keyFor('Basic'));
    // No immortal key: the eager-init write carries an expiry.
    expect(entry?.expireAt).not.toBeNull();
    expect(result.resetAt).toBe(entry?.expireAt);
  });

  it('returns the stored balance without re-initialising', async () => {
    store.map.set(keyFor('Basic'), {
      value: '42',
      expireAt: Math.floor(Date.now() / 1000) + 100,
    });

    const result = await credits.read(USER, subs.subscription, 'Basic');
    expect(result.remaining).toBe(42);
  });

  it('clamps a negative stored balance to zero', async () => {
    store.map.set(keyFor('Basic'), { value: '-5', expireAt: null });
    const result = await credits.read(USER, subs.subscription, 'Basic');
    expect(result.remaining).toBe(0);
  });
});

describe('consume', () => {
  it('decrements the balance by the given amount', async () => {
    store.map.set(keyFor('Basic'), { value: '10', expireAt: null });
    await credits.consume(USER, 'Basic', 3);
    expect(store.map.get(keyFor('Basic'))?.value).toBe('7');
  });
});

describe('reset / maxOut carry an expiry (no immortal key)', () => {
  it('reset writes the full limit with an expiry', async () => {
    await credits.reset(USER);
    const entry = store.map.get(keyFor('Basic'));
    expect(entry?.value).toBe('250');
    expect(entry?.expireAt).not.toBeNull();
  });

  it('maxOut writes zero with an expiry and reports the previous limit', async () => {
    subs.tier = 'Pro';
    const result = await credits.maxOut(USER);
    expect(result).toMatchObject({ tier: 'Pro', previousLimit: 1600 });
    const entry = store.map.get(keyFor('Pro'));
    expect(entry?.value).toBe('0');
    expect(entry?.expireAt).not.toBeNull();
  });
});

describe('overrideExpiry', () => {
  it('moves only the expiry when the key already exists', async () => {
    const original = Math.floor(Date.now() / 1000) + 100;
    store.map.set(keyFor('Basic'), { value: '99', expireAt: original });
    const newExpiry = Math.floor(Date.now() / 1000) + 5000;

    const result = await credits.overrideExpiry(USER, newExpiry);

    expect(result.keyExisted).toBe(true);
    expect(result.previousExpiryTimestamp).not.toBeNull();
    const entry = store.map.get(keyFor('Basic'));
    expect(entry?.value).toBe('99');
    expect(entry?.expireAt).toBe(newExpiry);
  });

  it('creates the key with the full limit and new expiry when missing', async () => {
    const newExpiry = Math.floor(Date.now() / 1000) + 5000;

    const result = await credits.overrideExpiry(USER, newExpiry);

    expect(result.keyExisted).toBe(false);
    expect(result.previousExpiryTimestamp).toBeNull();
    const entry = store.map.get(keyFor('Basic'));
    expect(entry?.value).toBe('250');
    expect(entry?.expireAt).toBe(newExpiry);
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
