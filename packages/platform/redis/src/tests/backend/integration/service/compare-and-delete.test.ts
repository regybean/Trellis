import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { nsKey, redis } from '../../../../client';
import { flushTestDb } from '../../../../testing';

/**
 * `compareAndDelete` — integration test against a REAL Redis (this suite's
 * isolated logical DB), no mocks: the whole contract IS the server-side
 * atomicity, which a fake client cannot express.
 *
 * The op is the owner-checked release for a value-owned lock (`SET key owner NX
 * EX`, the shape chat's In-flight lock uses). What it buys over a client-side
 * `GET` then `DEL` is the interleaving in the last test: between those two round
 * trips a lapsed TTL lets a NEW owner acquire the key, and the old owner's `DEL`
 * then deletes the new owner's lock. Inside EVAL nothing can interleave.
 */

const lockKey = nsKey('cad-test', 'lock');

beforeEach(async () => {
  await flushTestDb();
});
afterEach(async () => {
  await flushTestDb();
});

describe('compareAndDelete', () => {
  it('deletes the key when the value still matches', async () => {
    await redis.set(lockKey, 'owner-a');

    expect(await redis.compareAndDelete(lockKey, 'owner-a')).toBe(true);
    expect(await redis.get(lockKey)).toBeNull();
  });

  it('leaves a key held by another owner untouched', async () => {
    await redis.set(lockKey, 'owner-b', { EX: 60 });

    expect(await redis.compareAndDelete(lockKey, 'owner-a')).toBe(false);
    expect(await redis.get(lockKey)).toBe('owner-b');
    // The other owner keeps its expiry too — a failed release is a full no-op.
    expect(await redis.ttl(lockKey)).toBeGreaterThan(0);
  });

  it('reports false for a key that is already gone', async () => {
    expect(await redis.compareAndDelete(lockKey, 'owner-a')).toBe(false);
  });

  it('admits exactly one winner when the same owner releases concurrently', async () => {
    await redis.set(lockKey, 'owner-a');

    const results = await Promise.all([
      redis.compareAndDelete(lockKey, 'owner-a'),
      redis.compareAndDelete(lockKey, 'owner-a'),
      redis.compareAndDelete(lockKey, 'owner-a'),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await redis.get(lockKey)).toBeNull();
  });

  it('does not clobber a lock re-acquired after the old owner’s TTL lapsed', async () => {
    // The race this op exists for, made deterministic: `owner-a`'s lock expires
    // (a 1-tick TTL stands in for a crashed worker's 600s one) and `owner-b`
    // acquires it. `owner-a` then releases — which must be a no-op.
    await redis.set(lockKey, 'owner-a', { PX: 20 });
    await new Promise((resolve) => setTimeout(resolve, 40));
    const reacquired = await redis.set(lockKey, 'owner-b', {
      NX: true,
      EX: 60,
    });
    expect(reacquired).not.toBeNull();

    expect(await redis.compareAndDelete(lockKey, 'owner-a')).toBe(false);
    expect(await redis.get(lockKey)).toBe('owner-b');
  });
});
