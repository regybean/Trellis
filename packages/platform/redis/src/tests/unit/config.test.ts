import { describe, expect, it } from 'vitest';

import type { ConfigContext } from '@acme/config';

import { redisConfig } from '../../config';

/**
 * Unit tests for `redisConfig` (ADR 0026, #124). The `ConfigContext` is injected
 * directly — no `process.env`, mirroring `@acme/config`'s own tests — so the base
 * default and the client guard are exercised in isolation from `env.ts`.
 */
const context = (isServer: boolean, appEnv: ConfigContext['appEnv']) => ({
  appEnv,
  isServer,
});

describe('redisConfig', () => {
  it('returns the base REDIS_URL default from config', () => {
    const config = redisConfig(context(true, 'development'));
    expect(config.REDIS_URL).toBe('redis://localhost:6379');
  });

  it('throws when the server-only REDIS_URL is read on the client', () => {
    const config = redisConfig(context(false, 'development'));
    expect(() => config.REDIS_URL).toThrow(/server-only/);
  });
});
