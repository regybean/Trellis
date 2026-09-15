/**
 * The reaper toggle: off by default, and an outer value wins.
 *
 * The rule is a function over a record, so the branch a CI runner takes is
 * assertable here without a run that has `TESTCONTAINERS_RYUK_DISABLED` set —
 * and without touching the real environment, which stays real.
 */
import { describe, expect, it } from 'vitest';

import { ryukDisabled } from '../../../containers';

describe('ryukDisabled', () => {
  it('disables the reaper when nothing says otherwise', () => {
    expect(ryukDisabled({})).toBe('true');
  });

  it('keeps an explicit opt back in', () => {
    expect(ryukDisabled({ TESTCONTAINERS_RYUK_DISABLED: 'false' })).toBe(
      'false',
    );
  });

  it('keeps an explicit value even when it agrees with the default', () => {
    expect(ryukDisabled({ TESTCONTAINERS_RYUK_DISABLED: 'true' })).toBe('true');
  });

  it('treats an empty string as a value, not as absence', () => {
    expect(ryukDisabled({ TESTCONTAINERS_RYUK_DISABLED: '' })).toBe('');
  });
});
