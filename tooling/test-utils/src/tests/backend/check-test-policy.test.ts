/**
 * Verifies the layout rule in `scripts/check-test-policy.mjs` against throwaway
 * workspaces in a temp dir.
 *
 * Each case is a whole workspace, because the rule is about a *relationship*
 * between a package's `acme.testClass` and where its test files sit on disk.
 * Nothing is stubbed: the checker walks the filesystem, so the fixtures are
 * real manifests and real (empty) test files under a real `packages/` tree.
 *
 * The **passing** cases carry as much weight as the failures. `passWithNoTests`
 * stays on, so a file this rule waves through and the projects don't collect is
 * a test that silently never runs.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
// src/tests/backend -> repo root is five levels up.
const repoRoot = resolve(here, '../../../../../');
const CHECKER = join(repoRoot, 'scripts/check-test-policy.mjs');

const sandboxes: string[] = [];

afterEach(() => {
  for (const dir of sandboxes.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/**
 * A throwaway workspace holding exactly `files`. A key ending in `/` is an
 * empty directory — the sidedness rule reads the directory, not its contents,
 * so an empty `frontend/` in a backend-only package has to be expressible.
 */
function sandbox(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'check-test-policy-'));
  sandboxes.push(dir);

  for (const [path, content] of Object.entries(files)) {
    if (path.endsWith('/')) {
      mkdirSync(join(dir, path), { recursive: true });
      continue;
    }
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }

  return dir;
}

function check(dir: string, ...args: string[]) {
  const result = spawnSync('node', [CHECKER, dir, ...args], {
    encoding: 'utf8',
  });
  return {
    status: result.status,
    stdout: result.stdout,
    output: result.stdout + result.stderr,
  };
}

const SCRIPTS = {
  'full-stack': {
    test: 'true',
    'test:backend': 'true',
    'test:backend:watch': 'true',
    'test:frontend': 'true',
    'test:frontend:watch': 'true',
    'test:watch': 'true',
  },
  'backend-library': {
    test: 'true',
    'test:backend': 'true',
    'test:backend:watch': 'true',
  },
  'frontend-library': {
    test: 'true',
    'test:frontend': 'true',
    'test:frontend:watch': 'true',
  },
} as const;

/** A package manifest of the given class, carrying the scripts its class owes. */
function manifest(
  name: string,
  testClass: keyof typeof SCRIPTS,
  acme: Record<string, string> = {},
) {
  return `${JSON.stringify(
    {
      name: `@acme/${name}`,
      scripts: SCRIPTS[testClass],
      acme: { testClass, ...acme },
    },
    null,
    2,
  )}\n`;
}

const ALPHA = 'packages/features/alpha';
const BETA = 'packages/platform/beta';

/** One conforming full-stack feature: both layers, tests filed by seam. */
function baseline(): Record<string, string> {
  return {
    [`${ALPHA}/package.json`]: manifest('alpha', 'full-stack'),
    [`${ALPHA}/src/tests/backend/unit/policy.test.ts`]: '',
    [`${ALPHA}/src/tests/frontend/integration/hooks/use-alpha.test.tsx`]: '',
  };
}

describe('every test sits under src/tests/<layer>/', () => {
  it('passes on the conforming layout', () => {
    const { status, stdout } = check(sandbox(baseline()));

    expect(status).toBe(0);
    expect(stdout).toContain('Test policy satisfied');
  });

  it('fails on a test outside src/tests/, naming the package and the path', () => {
    const stray = `${ALPHA}/src/api/routers/alpha.test.ts`;
    const dir = sandbox({ ...baseline(), [stray]: '' });

    const { status, output } = check(dir);

    expect(status).toBe(1);
    expect(output).toContain('@acme/alpha');
    expect(output).toContain('src/api/routers/alpha.test.ts');
  });

  it('fails on a test under src/tests/ with the layer segment missing', () => {
    const dir = sandbox({
      ...baseline(),
      [`${ALPHA}/src/tests/unit/policy.test.ts`]: '',
    });

    const { status, output } = check(dir);

    expect(status).toBe(1);
    expect(output).toContain('@acme/alpha');
    expect(output).toContain('src/tests/unit/policy.test.ts');
  });

  it('fails on a third layer name, since only two are collected', () => {
    const dir = sandbox({
      ...baseline(),
      [`${ALPHA}/src/tests/e2e/unit/smoke.test.ts`]: '',
    });

    const { status, output } = check(dir);

    expect(status).toBe(1);
    expect(output).toContain('src/tests/e2e');
  });

  it('fails on a .tsx test in the backend layer — the backend glob is .test.ts', () => {
    const dir = sandbox({
      ...baseline(),
      [`${ALPHA}/src/tests/backend/unit/policy.test.tsx`]: '',
    });

    const { status, output } = check(dir);

    expect(status).toBe(1);
    expect(output).toContain('src/tests/backend/unit/policy.test.tsx');
  });

  it('fails on a *.spec.ts, which neither project collects', () => {
    const dir = sandbox({
      ...baseline(),
      [`${ALPHA}/src/tests/backend/unit/policy.spec.ts`]: '',
    });

    const { status, output } = check(dir);

    expect(status).toBe(1);
    expect(output).toContain('policy.spec.ts');
  });
});

describe('the layers a package may carry follow its testClass', () => {
  it('fails on a backend-library carrying src/tests/frontend/', () => {
    const dir = sandbox({
      [`${BETA}/package.json`]: manifest('beta', 'backend-library'),
      [`${BETA}/src/tests/backend/unit/policy.test.ts`]: '',
      [`${BETA}/src/tests/frontend/`]: '',
    });

    const { status, output } = check(dir);

    expect(status).toBe(1);
    expect(output).toContain('@acme/beta');
    expect(output).toContain('src/tests/frontend');
    expect(output).toContain('backend-library');
  });

  it('fails on a frontend-library carrying src/tests/backend/', () => {
    const dir = sandbox({
      [`${BETA}/package.json`]: manifest('beta', 'frontend-library'),
      [`${BETA}/src/tests/frontend/unit/format.test.tsx`]: '',
      [`${BETA}/src/tests/backend/`]: '',
    });

    const { status, output } = check(dir);

    expect(status).toBe(1);
    expect(output).toContain('src/tests/backend');
  });

  it('passes on a single-sided package that keeps the layer segment', () => {
    const dir = sandbox({
      [`${BETA}/package.json`]: manifest('beta', 'backend-library'),
      [`${BETA}/src/tests/backend/unit/policy.test.ts`]: '',
    });

    expect(check(dir).status).toBe(0);
  });

  it('passes on a full-stack package carrying both layers', () => {
    expect(check(sandbox(baseline())).status).toBe(0);
  });
});

describe('a tracked gap is exempt', () => {
  it('does not apply the layout rule to a testStatus: todo package', () => {
    const dir = sandbox({
      [`${BETA}/package.json`]: `${JSON.stringify(
        {
          name: '@acme/beta',
          scripts: {},
          acme: {
            testClass: 'backend-library',
            testStatus: 'todo',
            reason: 'tests land with the next slice',
          },
        },
        null,
        2,
      )}\n`,
      [`${BETA}/src/tests/unit/policy.test.ts`]: '',
      [`${BETA}/src/tests/frontend/`]: '',
    });

    const { status } = check(dir);

    expect(status).toBe(0);
  });
});

describe('the root argument', () => {
  it('still lists tracked gaps when --todos follows the root', () => {
    const dir = sandbox({
      [`${BETA}/package.json`]: `${JSON.stringify(
        {
          name: '@acme/beta',
          scripts: {},
          acme: {
            testClass: 'backend-library',
            testStatus: 'todo',
            reason: 'tests land with the next slice',
          },
        },
        null,
        2,
      )}\n`,
    });

    const { status, stdout } = check(dir, '--todos');

    expect(status).toBe(0);
    expect(stdout).toContain('@acme/beta');
    expect(stdout).toContain('tests land with the next slice');
  });
});
