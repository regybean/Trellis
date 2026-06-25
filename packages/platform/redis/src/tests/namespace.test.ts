import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Unit tests for the per-app Redis key namespace.
 *
 * The prefix lives in `nsKey`: it is the single place NEXT_PUBLIC_WEBAPP is
 * applied, and the only way to construct a `NamespacedKey` (which every
 * key-bearing client method demands — so a raw, unprefixed key is a compile
 * error, not a silent cross-app collision). These tests assert the prefixing in
 * both branches (namespace set vs empty) without touching a real Redis — `redis`
 * and `@acme/logger` are mocked, and IS_NEXT_BUILD short-circuits the connect()
 * side effect on import. See docs/adr/0008-per-app-redis-namespace.md.
 */

// Skip the connect() side effect that runs on client.ts import.
process.env.IS_NEXT_BUILD = 'true';

const loadClient = async (webapp: string | undefined) => {
  vi.resetModules();

  vi.doMock('@acme/logger', () => ({
    logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  }));
  vi.doMock('redis', () => ({
    createClient: vi.fn(() => ({
      on: vi.fn(),
      connect: vi.fn().mockResolvedValue(undefined),
      duplicate: vi.fn(() => ({ on: vi.fn() })),
    })),
  }));
  vi.doMock('../env', () => ({
    env: {
      REDIS_URL: 'redis://localhost:6379',
      NEXT_PUBLIC_WEBAPP: webapp,
    },
  }));

  return import('../client');
};

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe('nsKey', () => {
  it('prefixes the key with the app namespace', async () => {
    const { nsKey } = await loadClient('nextjs');

    expect(nsKey('credits', 'user_1', 'pro')).toBe('nextjs:credits:user_1:pro');
    expect(nsKey('stripe', 'user', 'user_1')).toBe('nextjs:stripe:user:user_1');
  });

  it('joins parts with colons before prefixing', async () => {
    const { nsKey } = await loadClient('tanstack_start');

    expect(nsKey('jobs')).toBe('tanstack_start:jobs');
  });

  it('leaves keys raw with no leading colon when the namespace is empty', async () => {
    const { nsKey } = await loadClient(undefined);

    expect(nsKey('credits', 'user_1', 'pro')).toBe('credits:user_1:pro');
    expect(nsKey('jobs')).toBe('jobs');
  });
});
