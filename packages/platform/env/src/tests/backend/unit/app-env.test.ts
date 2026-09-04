import { describe, expect, it } from 'vitest';

import { resolveAppEnv } from '../../../app-env';

describe('resolveAppEnv', () => {
  it('defaults to development when unset (dev-is-base)', () => {
    const unset: string | undefined = undefined;
    expect(resolveAppEnv(unset)).toBe('development');
  });

  it('treats an empty string as unset → development', () => {
    expect(resolveAppEnv('')).toBe('development');
  });

  it.each(['development', 'staging', 'production'] as const)(
    'passes through the known target %s',
    (value) => {
      expect(resolveAppEnv(value)).toBe(value);
    },
  );

  it('throws on an unknown value, naming it (loud, not silent)', () => {
    expect(() => resolveAppEnv('prod')).toThrow(
      /APP_ENV is not a known deploy target/,
    );
  });
});
