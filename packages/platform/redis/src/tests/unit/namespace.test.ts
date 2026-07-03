import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Unit tests for the per-app Redis key namespace.
 *
 * The prefix lives in `nsKey`: it is the single place NEXT_PUBLIC_WEBAPP is
 * applied, and the only way to construct a `NamespacedKey` (which every
 * key-bearing client method demands — so a raw, unprefixed key is a compile
 * error, not a silent cross-app collision). These tests assert the prefixing in
 * both branches (namespace set vs empty).
 *
 * Per ADR 0014 the real `./env` is validated, never mocked: the webapp is set
 * via `vi.stubEnv` before each fresh import. `IS_NEXT_BUILD` short-circuits the
 * `connect()` side effect on `./client` import, so no real Redis is touched. The
 * empty-namespace branch is only reachable when validation is skipped (a missing
 * webapp otherwise fails `env.ts` loudly), so that case sets `CI=true` to take
 * the real `skipValidation` path rather than mocking the env module.
 * See docs/adr/0008-per-app-redis-namespace.md.
 */

const loadClient = async (webapp?: string) => {
  vi.resetModules();
  // Skip the connect() side effect that runs on client.ts import.
  vi.stubEnv('IS_NEXT_BUILD', 'true');
  vi.stubEnv('REDIS_URL', 'redis://localhost:6379');

  if (webapp === undefined) {
    // A missing webapp only passes env.ts when validation is skipped (the real
    // CI / build path); exercise the empty-namespace branch through it rather
    // than by mocking the env module.
    vi.stubEnv('CI', 'true');
    vi.stubEnv('NEXT_PUBLIC_WEBAPP', '');
  } else {
    vi.stubEnv('NEXT_PUBLIC_WEBAPP', webapp);
  }

  return import('../../client');
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
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
    const { nsKey } = await loadClient();

    expect(nsKey('credits', 'user_1', 'pro')).toBe('credits:user_1:pro');
    expect(nsKey('jobs')).toBe('jobs');
  });
});
