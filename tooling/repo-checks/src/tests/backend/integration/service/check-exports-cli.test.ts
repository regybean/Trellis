/**
 * `check-exports` as a command: the exit code, one golden output shape, and the
 * root argument it lacked.
 *
 * That argument is the whole reason this file can exist. The checker used to
 * derive the directory it policed from its own file's depth, so it could only
 * ever check the repo it lived in — which is why it shipped with no tests at
 * all while the other two checkers had twenty-two between them.
 */
import { afterAll, describe, expect, it } from 'vitest';

import {
  createRepoFixture,
  manifest,
  removeRepoFixtures,
  runCheck,
} from '../../repo-fixture';

afterAll(removeRepoFixtures);

const jit = (name: string) => ({
  types: `./dist/${name}.d.ts`,
  default: `./src/${name}.ts`,
});

const check = (root: string) => runCheck('check-exports', [root]);

describe('the root argument', () => {
  it('checks the directory it is given', () => {
    const root = createRepoFixture({
      files: {
        'packages/features/chat/package.json': manifest({
          name: '@acme/chat',
          exports: { '.': jit('index') },
        }),
      },
    });

    const { status, stdout } = check(root);

    expect(status).toBe(0);
    expect(stdout).toContain('check-exports: 1 runtime package');
  });
});

describe('a violating map', () => {
  it('exits non-zero, names the package and points at the contract', () => {
    const root = createRepoFixture({
      files: {
        'packages/platform/db/package.json': manifest({
          name: '@acme/db',
          exports: { './styles': jit('styles') },
        }),
      },
    });

    const { status, stdout, stderr } = check(root);

    expect(status).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toContain('check-exports found 1 problem');
    expect(stderr).toContain('@acme/db');
    expect(stderr).toContain('./styles');
    expect(stderr).toContain('bounded vocabulary');
  });

  it('counts every problem it found', () => {
    const root = createRepoFixture({
      files: {
        'packages/platform/db/package.json': manifest({
          name: '@acme/db',
          exports: { '.': './src/index.ts' },
        }),
        'packages/shared/ui/package.json': manifest({
          name: '@acme/ui',
          exports: { './styles': jit('styles') },
        }),
      },
    });

    expect(check(root).stderr).toContain('check-exports found 2 problems');
  });
});

describe('what it leaves alone', () => {
  it('passes a workspace whose only packages ship no exports map', () => {
    const root = createRepoFixture({
      files: {
        'apps/web/package.json': manifest({ name: '@acme/web' }),
        'tooling/eslint/package.json': manifest({
          name: '@acme/eslint-config',
          exports: { './base': './base.ts' },
        }),
      },
    });

    const { status, stdout } = check(root);

    expect(status).toBe(0);
    expect(stdout).toContain('0 runtime packages');
  });
});

describe('the repo it lives in', () => {
  it('passes with no argument at all — the way the gate invokes it', () => {
    const { status, stdout } = runCheck('check-exports', []);

    expect(status).toBe(0);
    expect(stdout).toContain('every exports map conforms');
  });
});
