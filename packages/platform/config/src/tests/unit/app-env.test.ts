import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';

import { resolveAppEnv } from '../../app-env';
import { ConfigValidationError } from '../../errors';

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

  it('throws ConfigValidationError on an unknown value (loud, not silent)', () => {
    expect(() => resolveAppEnv('prod')).toThrowError(ConfigValidationError);
  });

  it('surfaces the zod error on the thrown instance', () => {
    try {
      resolveAppEnv('staging2');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigValidationError);
      if (error instanceof ConfigValidationError) {
        expect(error.zodError).toBeInstanceOf(z.ZodError);
      }
    }
  });
});
