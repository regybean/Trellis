/**
 * `check-test-policy` as a command: exit codes, the `--todos` listing, and the
 * root argument, with or without the flag beside it. The rules underneath have
 * their own unit tests.
 */
import { afterAll, describe, expect, it } from 'vitest';

import {
  createRepoFixture,
  manifest,
  removeRepoFixtures,
  runCheck,
} from '../../repo-fixture';

afterAll(removeRepoFixtures);

const check = (root: string, ...args: string[]) =>
  runCheck('check-test-policy', [root, ...args]);

const BACKEND_SCRIPTS = {
  test: 'true',
  'test:backend': 'true',
  'test:backend:watch': 'true',
};

const gap = manifest({
  name: '@acme/beta',
  acme: {
    testClass: 'backend-library',
    testStatus: 'todo',
    reason: 'tests land with the next slice',
  },
});

describe('a conforming workspace', () => {
  it('exits zero with the tracked-gap count', () => {
    const root = createRepoFixture({
      files: {
        'packages/platform/beta/package.json': manifest({
          name: '@acme/beta',
          scripts: BACKEND_SCRIPTS,
          acme: { testClass: 'backend-library' },
        }),
        'packages/platform/beta/src/tests/backend/unit/policy.test.ts': '',
      },
    });

    const { status, stdout } = check(root);

    expect(status).toBe(0);
    expect(stdout).toContain('Test policy satisfied (0 tracked gaps');
  });
});

describe('a misplaced test', () => {
  it('exits non-zero, naming the package, the path and the contract', () => {
    const root = createRepoFixture({
      files: {
        'packages/platform/beta/package.json': manifest({
          name: '@acme/beta',
          scripts: BACKEND_SCRIPTS,
          acme: { testClass: 'backend-library' },
        }),
        'packages/platform/beta/src/api/routers/beta.test.ts': '',
      },
    });

    const { status, stderr } = check(root);

    expect(status).toBe(1);
    expect(stderr).toContain('@acme/beta');
    expect(stderr).toContain('src/api/routers/beta.test.ts');
    expect(stderr).toContain('docs/TESTING.md');
  });

  it('sees an empty layer directory the class forbids', () => {
    const root = createRepoFixture({
      files: {
        'packages/platform/beta/package.json': manifest({
          name: '@acme/beta',
          scripts: BACKEND_SCRIPTS,
          acme: { testClass: 'backend-library' },
        }),
        'packages/platform/beta/src/tests/backend/unit/policy.test.ts': '',
        'packages/platform/beta/src/tests/frontend/': '',
      },
    });

    const { status, stderr } = check(root);

    expect(status).toBe(1);
    expect(stderr).toContain('src/tests/frontend/');
  });
});

describe('an unknown infra profile', () => {
  const files = {
    'deploy/compose.yaml':
      'services:\n  postgres:\n    profiles:\n      - postgres\n',
    'packages/platform/beta/package.json': manifest({
      name: '@acme/beta',
      scripts: BACKEND_SCRIPTS,
      acme: { testClass: 'backend-library', infra: ['postgress'] },
    }),
    'packages/platform/beta/src/tests/backend/unit/policy.test.ts': '',
  };

  it('exits non-zero, naming the package and the profile', () => {
    const { status, stderr } = check(createRepoFixture({ files }));

    expect(status).toBe(1);
    expect(stderr).toContain('@acme/beta');
    expect(stderr).toContain('postgress');
  });

  it('passes the same package once the profile exists', () => {
    const root = createRepoFixture({
      files: {
        ...files,
        'packages/platform/beta/package.json': manifest({
          name: '@acme/beta',
          scripts: BACKEND_SCRIPTS,
          acme: { testClass: 'backend-library', infra: ['postgres'] },
        }),
      },
    });

    expect(check(root).status).toBe(0);
  });

  it('validates nothing in a workspace that ships no compose file', () => {
    const root = createRepoFixture({
      files: {
        'packages/platform/beta/package.json': manifest({
          name: '@acme/beta',
          scripts: BACKEND_SCRIPTS,
          acme: { testClass: 'backend-library', infra: ['whatever'] },
        }),
        'packages/platform/beta/src/tests/backend/unit/policy.test.ts': '',
      },
    });

    expect(check(root).status).toBe(0);
  });
});

describe('--todos', () => {
  it('lists the tracked gaps and exits zero, with the flag after the root', () => {
    const root = createRepoFixture({
      files: { 'packages/platform/beta/package.json': gap },
    });

    const { status, stdout } = check(root, '--todos');

    expect(status).toBe(0);
    expect(stdout).toContain('@acme/beta');
    expect(stdout).toContain('tests land with the next slice');
  });

  it('says so when there are none', () => {
    const root = createRepoFixture({ files: {} });

    const { status, stdout } = check(root, '--todos');

    expect(status).toBe(0);
    expect(stdout).toContain('No tracked test gaps');
  });
});

describe('the repo it lives in', () => {
  it('passes with no argument at all — the way the gate invokes it', () => {
    const { status, stdout } = runCheck('check-test-policy', []);

    expect(status).toBe(0);
    expect(stdout).toContain('Test policy satisfied');
  });
});
