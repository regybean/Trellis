/**
 * `check-imports` as a command: the exit code, the root argument, and that a
 * failure prints enough to act on without opening anything else.
 */
import { afterAll, describe, expect, it } from 'vitest';

import {
  createRepoFixture,
  manifest,
  removeRepoFixtures,
  runCheck,
} from '../../repo-fixture';

afterAll(removeRepoFixtures);

const check = (root: string) => runCheck('check-imports', [root]);

describe('the root argument', () => {
  it('checks the directory it is given', () => {
    const root = createRepoFixture({
      files: {
        'packages/platform/db/package.json': manifest({
          name: '@acme/db',
          dependencies: { zod: 'catalog:' },
        }),
        'packages/platform/db/src/env.ts': `import { z } from 'zod/v4';\n`,
      },
    });

    const { status, stdout } = check(root);

    expect(status).toBe(0);
    expect(stdout).toContain('check-imports: 1 package');
  });
});

describe('an undeclared import', () => {
  it('exits non-zero and names the package, the import and the file', () => {
    const root = createRepoFixture({
      files: {
        'packages/platform/db/package.json': manifest({ name: '@acme/db' }),
        'packages/platform/db/src/env.ts': `import { z } from 'zod/v4';\n`,
      },
    });

    const { status, output } = check(root);

    expect(status).toBe(1);
    expect(output).toContain('@acme/db');
    expect(output).toContain('`zod`');
    expect(output).toContain('src/env.ts');
  });

  it('points at the contract and at where a suppression goes', () => {
    const root = createRepoFixture({
      files: {
        'packages/platform/db/package.json': manifest({ name: '@acme/db' }),
        'packages/platform/db/src/env.ts': `import { z } from 'zod';\n`,
      },
    });

    const { output } = check(root);

    expect(output).toContain('acme.undeclaredImports');
    expect(output).toContain('tooling/repo-checks/src/imports.ts');
  });
});

describe('a suppression', () => {
  it('passes the import it names, and only that one', () => {
    const root = createRepoFixture({
      files: {
        'packages/platform/db/package.json': manifest({
          name: '@acme/db',
          acme: { undeclaredImports: { zod: 'provided by the host app' } },
        }),
        'packages/platform/db/src/env.ts': `import { z } from 'zod';\nimport { Redis } from 'ioredis';\n`,
      },
    });

    const { status, output } = check(root);

    expect(status).toBe(1);
    expect(output).toContain('`ioredis`');
    expect(output).not.toContain('`zod`');
  });
});
