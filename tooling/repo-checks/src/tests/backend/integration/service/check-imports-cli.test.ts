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

describe('generated output', () => {
  // The regression this exists for: a built TanStack app put bundled vendor
  // code in `.output/server/_libs/`, and the check read it as the app importing
  // `msgpackr-extract`. True of the file, meaningless about the package — and it
  // only appeared once somebody had run a build, so a clean checkout passed and
  // the same commit failed afterwards.
  it.each(['.output', '.nitro', '.tanstack', '.next', 'dist', '.mastra'])(
    'is not scanned under %s/',
    (dir) => {
      const root = createRepoFixture({
        files: {
          'apps/web/package.json': manifest({ name: '@acme/web' }),
          [`apps/web/${dir}/server/_libs/bundled.mjs`]: `import x from 'msgpackr-extract';\n`,
        },
      });

      const { status, stdout } = check(root);

      expect(status).toBe(0);
      expect(stdout).not.toContain('msgpackr-extract');
    },
  );

  it('still reads the source beside it', () => {
    // The skip is the directory, not the package: a built app is still checked.
    const root = createRepoFixture({
      files: {
        'apps/web/package.json': manifest({ name: '@acme/web' }),
        'apps/web/.output/server/_libs/bundled.mjs': `import x from 'msgpackr-extract';\n`,
        'apps/web/src/entry.ts': `import { z } from 'zod';\n`,
      },
    });

    const { status, output } = check(root);

    expect(status).toBe(1);
    expect(output).toContain('`zod`');
    expect(output).toContain('src/entry.ts');
    expect(output).not.toContain('msgpackr-extract');
  });
});
