import { afterEach, describe, expect, it, vi } from 'vitest';

import { shouldSkipEnvValidation } from '../../env';

// vitest sets VITEST in every worker, so cases that exercise the non-test
// branches stub it to '' — the predicate only reads truthiness, so an empty
// string models "absent". unstubAllEnvs restores the real values after each case.
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('shouldSkipEnvValidation', () => {
  it('skips for the lint step regardless of other signals', () => {
    vi.stubEnv('npm_lifecycle_event', 'lint');
    vi.stubEnv('VITEST', 'true');
    vi.stubEnv('CI', 'true');
    expect(shouldSkipEnvValidation()).toBe(true);
  });

  it('skips a Next build via IS_NEXT_BUILD (set before NEXT_PHASE exists)', () => {
    vi.stubEnv('IS_NEXT_BUILD', 'true');
    vi.stubEnv('VITEST', 'true');
    expect(shouldSkipEnvValidation()).toBe(true);
  });

  it('also skips on the NEXT_PHASE production-build signal', () => {
    vi.stubEnv('NEXT_PHASE', 'phase-production-build');
    vi.stubEnv('VITEST', 'true');
    expect(shouldSkipEnvValidation()).toBe(true);
  });

  it('validates under vitest even when CI is set', () => {
    vi.stubEnv('VITEST', 'true');
    vi.stubEnv('CI', 'true');
    expect(shouldSkipEnvValidation()).toBe(false);
  });

  it('skips on a non-test CI step (no VITEST)', () => {
    vi.stubEnv('VITEST', '');
    vi.stubEnv('CI', 'true');
    expect(shouldSkipEnvValidation()).toBe(true);
  });

  it('validates locally (no lint/build/CI)', () => {
    vi.stubEnv('VITEST', '');
    vi.stubEnv('CI', '');
    expect(shouldSkipEnvValidation()).toBe(false);
  });
});
