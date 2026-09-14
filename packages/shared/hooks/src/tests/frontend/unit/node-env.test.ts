/**
 * `resolveNodeEnv` — the narrowing a feature that owns no env module would
 * otherwise re-derive for itself.
 *
 * The three valid values pass through untouched; everything else, including an
 * absent variable, resolves to `'production'`. That default is the whole reason
 * the helper exists — it is what keeps a missing `NODE_ENV` from handing a
 * deployed process the dev logger link or the MSW seam — so it is the case
 * worth pinning.
 */
import { describe, expect, it } from 'vitest';

import { resolveNodeEnv } from '../../../node-env';

describe('resolveNodeEnv', () => {
  it.each(['development', 'production', 'test'])(
    'returns %s unchanged',
    (value) => {
      expect(resolveNodeEnv(value)).toBe(value);
    },
  );

  it('falls back to production when the variable is absent', () => {
    // The shape absence actually arrives in: an environment with no such row.
    const environmentWithoutNodeEnv: Record<string, string | undefined> = {};

    expect(resolveNodeEnv(environmentWithoutNodeEnv.NODE_ENV)).toBe(
      'production',
    );
  });

  it.each(['', 'staging', 'Production', 'dev'])(
    'falls back to production for the unrecognised value %o',
    (value) => {
      expect(resolveNodeEnv(value)).toBe('production');
    },
  );
});
