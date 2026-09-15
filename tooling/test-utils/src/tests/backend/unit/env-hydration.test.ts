/**
 * `hydrateEnv` — what a suite's `process.env` becomes, as a value.
 *
 * The rule used to run as a top-level side effect, so the only way to exercise
 * it was to import the module in the right order and read `process.env` back.
 * As a function over a record, the Redis allocation and the url rewrite are
 * assertable directly: nothing is injected, nothing is written, and the real
 * environment stays real.
 */
import { describe, expect, it } from 'vitest';

import { hydrateEnv } from '../../../env-hydration';

describe('hydrateEnv', () => {
  it('resolves every key the infra contributes', () => {
    expect(
      hydrateEnv({
        infraEnv: { DB_HOST: 'localhost', DB_PORT: '54321' },
      }),
    ).toEqual({ DB_HOST: 'localhost', DB_PORT: '54321' });
  });

  it('drops keys the infra left empty or absent', () => {
    expect(
      hydrateEnv({
        infraEnv: { DB_HOST: 'localhost', DB_PASSWORD: '', DB_USER: undefined },
      }),
    ).toEqual({ DB_HOST: 'localhost' });
  });

  it('gives nothing back when the suite names no infra', () => {
    expect(hydrateEnv({ infraEnv: {} })).toEqual({});
  });

  it('appends the suite logical db to the injected redis url', () => {
    expect(
      hydrateEnv({
        infraEnv: { REDIS_URL: 'redis://localhost:6390' },
        redisDb: '2',
      }).REDIS_URL,
    ).toBe('redis://localhost:6390/2');
  });

  it('appends the logical db once, whatever trailing slashes the url carries', () => {
    expect(
      hydrateEnv({
        infraEnv: { REDIS_URL: 'redis://localhost:6390///' },
        redisDb: '2',
      }).REDIS_URL,
    ).toBe('redis://localhost:6390/2');
  });

  it('keeps the injected redis url when the suite allocates no logical db', () => {
    expect(
      hydrateEnv({ infraEnv: { REDIS_URL: 'redis://localhost:6390' } })
        .REDIS_URL,
    ).toBe('redis://localhost:6390');
  });

  it('treats an empty logical db as no allocation', () => {
    expect(
      hydrateEnv({
        infraEnv: { REDIS_URL: 'redis://localhost:6390' },
        redisDb: '',
      }).REDIS_URL,
    ).toBe('redis://localhost:6390');
  });

  it('invents no redis url for a suite whose infra has no redis', () => {
    const resolved = hydrateEnv({
      infraEnv: { DB_HOST: 'localhost' },
      redisDb: '2',
    });

    expect(resolved).not.toHaveProperty('REDIS_URL');
  });

  it('leaves the other infra keys alone while rewriting the redis url', () => {
    expect(
      hydrateEnv({
        infraEnv: { DB_HOST: 'localhost', REDIS_URL: 'redis://localhost:6390' },
        redisDb: '7',
      }),
    ).toEqual({
      DB_HOST: 'localhost',
      REDIS_URL: 'redis://localhost:6390/7',
    });
  });

  it('writes nothing — the caller owns the assignment', () => {
    hydrateEnv({ infraEnv: { ACME_HYDRATE_PROBE: 'written' } });

    // eslint-disable-next-line turbo/no-undeclared-env-vars
    expect(process.env.ACME_HYDRATE_PROBE).toBeUndefined();
  });
});
