/**
 * What the tool derives from the vitest include globs.
 *
 * The globs are `@acme/test-utils`' — the same values the projects collect by —
 * and everything the report measures against them (the `src/tests` base, the
 * config filename per side) is computed rather than written down again. These
 * assert the derivation, including the two ways it is allowed to fail loudly:
 * silently deriving the wrong base would file every test under the wrong
 * heading.
 */
import { describe, expect, it } from 'vitest';

import { TEST_INCLUDE } from '@acme/test-utils/vitest';

import { configOf, TEST_LAYERS, TESTS_DIR, testsDir } from '../../../layout';

describe('the test directory comes from the include globs', () => {
  it('is the base both layers share', () => {
    expect(TESTS_DIR).toBe('src/tests');
  });

  it('follows the globs rather than a copy of them', () => {
    expect(
      testsDir({
        backend: 'suites/backend/**/*.test.ts',
        frontend: 'suites/frontend/**/*.test.{ts,tsx}',
      }),
    ).toBe('suites');
  });

  it('refuses globs whose layers sit under different roots', () => {
    expect(() =>
      testsDir({
        backend: 'src/tests/backend/**/*.test.ts',
        frontend: 'test/frontend/**/*.test.{ts,tsx}',
      }),
    ).toThrow(/do not share one test directory/);
  });

  it('refuses a glob that is not under its own layer segment', () => {
    expect(() =>
      testsDir({
        backend: 'src/tests/**/*.test.ts',
        frontend: 'src/tests/frontend/**/*.test.{ts,tsx}',
      }),
    ).toThrow(/backend/);
  });
});

describe('the layers are the ones the projects collect for', () => {
  it('names a config file per side, by convention', () => {
    expect(TEST_LAYERS.map(configOf)).toEqual([
      'vitest.config.backend.ts',
      'vitest.config.frontend.ts',
    ]);
  });

  it('has a glob for every layer, so no side goes uncollected', () => {
    for (const layer of TEST_LAYERS) {
      expect(TEST_INCLUDE[layer]).toContain(`/${layer}/`);
    }
  });
});
