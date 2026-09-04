/**
 * `pnpm test:inventory` — asserted at its stdout, which is its only contract.
 *
 * The tool is a repo script, so it is exercised the way the bank and secrets
 * suites exercise theirs: copied into a throwaway workspace and run. The
 * sandbox is a miniature of this repo — four packages across three layer
 * directories, each with a real vitest config built by `backendProject` /
 * `frontendProject` and real test files — so the assertions are about a
 * workspace's shape rather than about this month's test count.
 *
 * Package targets belong here for the same reason: naming a package needs no
 * dependency graph, so the sandbox can hold every case, including the two the
 * tool must refuse — a token that names nothing, and a short name that names
 * two things. App targets do need a resolved graph, so they are next door in
 * test-inventory-app-targets.test.ts, against the real repo.
 *
 * The `--layer`/`--kind`/`--out` flags are here too: the sandbox's layout is
 * the taxonomy those flags filter on, and a package that is frontend-only is
 * what makes "a package that keeps nothing loses its heading" assertable.
 *
 * The container assertion is the one worth explaining. A sandbox package's
 * `globalSetup` writes a marker file; the suite first runs `vitest list`
 * directly, without `VITEST_LIST_ONLY`, to prove the marker really is written
 * when globalSetup fires, then deletes it. If the carve-out ever regressed, the
 * inventory run would recreate it — which in the real repo is a testcontainer
 * and a schema push.
 *
 * One vitest behaviour is pinned here rather than assumed: `vitest list`
 * reports only the tests that would run, so a `.skip` never reaches the
 * inventory. The sandbox carries a skipped test to hold that fact still — if a
 * later vitest starts listing them, this suite says so.
 *
 * Structure is the contract, whitespace is not: nothing here asserts a literal
 * block of markdown.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
// src/tests/backend -> repo root is five levels up.
const repoRoot = resolve(here, '../../../../../');

/** Where the sandbox's marker lands if `globalSetup` runs. */
const MARKER = 'packages/platform/p-one/global-setup-ran';

let sandbox: string;
/** The inventory the tool printed for the sandbox — the subject of every test. */
let inventory: string;
/** The same sandbox, narrowed by the filter flags. One run each, in setup. */
let byLayer: string;
let byKind: string;
/** The same `--kind unit`, spelled the way `pnpm run -- …` forwards it. */
let byKindViaPnpm: string;
let byBoth: string;
let byEveryLayerAndKind: string;
/** The `--out` run: what reached stdout, and what landed in the file. */
let outStdout: string;
let outFile: string;
/** What `vitest list` reports for one sandbox package, run directly. */
let directNames: string[];
/** Whether that direct run — no carve-out — wrote the marker. The control. */
let globalSetupRanDirectly: boolean;

function write(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

/**
 * A sandbox package: manifest, vitest config(s) and test files, plus the
 * `@acme/test-utils` link a real package resolves its config factory through.
 */
function writePackage(
  dir: string,
  name: string,
  files: Record<string, string>,
) {
  const pkgDir = join(sandbox, dir);
  write(
    join(pkgDir, 'package.json'),
    `${JSON.stringify({ name, version: '0.0.0', private: true }, null, 2)}\n`,
  );
  mkdirSync(join(pkgDir, 'node_modules/@acme'), { recursive: true });
  symlinkSync(
    join(repoRoot, 'tooling/test-utils'),
    join(pkgDir, 'node_modules/@acme/test-utils'),
  );
  for (const [path, content] of Object.entries(files)) {
    write(join(pkgDir, path), content);
  }
}

/**
 * The parent vitest advertises itself through `VITEST_*`; a nested one must not
 * inherit that and mistake itself for a worker of this run.
 */
function childEnv() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('VITEST')),
  );
}

/**
 * The CLI, as the sandbox sees it. `--import tsx` rather than `pnpm exec` for
 * the same reason the tool runs vitest on this node: a package-manager startup
 * per invocation is time spent proving nothing.
 */
function collect(...args: string[]) {
  return execFileSync(
    process.execPath,
    ['--import', 'tsx', join(sandbox, 'scripts/test-inventory.ts'), ...args],
    { cwd: sandbox, env: childEnv(), encoding: 'utf8', stdio: 'pipe' },
  );
}

/** The same, for the cases where the failure is the subject. */
function collectFailing(...args: string[]) {
  return spawnSync(
    process.execPath,
    ['--import', 'tsx', join(sandbox, 'scripts/test-inventory.ts'), ...args],
    { cwd: sandbox, env: childEnv(), encoding: 'utf8' },
  );
}

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'test-inventory-'));

  write(
    join(sandbox, 'package.json'),
    `${JSON.stringify({ name: 'sandbox', private: true }, null, 2)}\n`,
  );
  // One resolution point, exactly as in this repo: every dependency (vitest
  // included) is found through the root node_modules.
  symlinkSync(join(repoRoot, 'node_modules'), join(sandbox, 'node_modules'));
  mkdirSync(join(sandbox, 'scripts/lib'), { recursive: true });
  cpSync(
    join(repoRoot, 'scripts/test-inventory.ts'),
    join(sandbox, 'scripts/test-inventory.ts'),
  );
  // The CLI resolves targets through the module it shares with resolve-infra,
  // so the sandbox needs that too.
  cpSync(
    join(repoRoot, 'scripts/lib/workspace-targets.ts'),
    join(sandbox, 'scripts/lib/workspace-targets.ts'),
  );

  // Two platform packages whose directory order (p-one, p-two) is the reverse
  // of their package-name order, so "alphabetical within a layer" is a claim
  // about the names and not an accident of readdir.
  writePackage('packages/platform/p-one', '@sandbox/redis', {
    'vitest.config.backend.ts': [
      "import { backendProject } from '@acme/test-utils/vitest';",
      '',
      'export default backendProject({',
      "  webapp: 'sandbox',",
      "  globalSetup: './src/tests/backend/global-setup.ts',",
      '});',
      '',
    ].join('\n'),
    'src/tests/backend/global-setup.ts': [
      "import { writeFileSync } from 'node:fs';",
      '',
      '// Stands in for the real thing: starting testcontainers and pushing a',
      '// schema, then publishing the connection details hydrate-env reads.',
      '// Listing must not reach here.',
      'export default function setup(project) {',
      "  writeFileSync(new URL('../../../global-setup-ran', import.meta.url), 'ran');",
      "  project.provide('infraEnv', {});",
      '}',
      '',
    ].join('\n'),
    'src/tests/backend/unit/keys.test.ts': [
      "describe('nsKey', () => {",
      "  it('namespaces a key', () => {",
      '    expect(1).toBe(1);',
      '  });',
      '',
      "  it.skip('rejects a raw string once the brand lands', () => {",
      '    expect(1).toBe(1);',
      '  });',
      '',
      "  it.each(['read', 'write'])('round-trips a %s', () => {",
      '    expect(1).toBe(1);',
      '  });',
      '});',
      '',
    ].join('\n'),
  });
  writePackage('packages/platform/p-two', '@sandbox/entitlements', {
    'vitest.config.backend.ts': [
      "import { backendProject } from '@acme/test-utils/vitest';",
      '',
      "export default backendProject({ webapp: 'sandbox' });",
      '',
    ].join('\n'),
    'src/tests/backend/integration/service/limits.test.ts': [
      "describe('limits', () => {",
      "  it('spends a credit', () => {",
      '    expect(1).toBe(1);',
      '  });',
      '});',
      '',
    ].join('\n'),
  });
  writePackage('packages/shared/ui', '@sandbox/ui', {
    'vitest.config.frontend.ts': [
      "import { frontendProject } from '@acme/test-utils/vitest';",
      '',
      'export default frontendProject();',
      '',
    ].join('\n'),
    'src/tests/frontend/integration/components/button.test.tsx': [
      "describe('<Button />', () => {",
      "  it('renders its label', () => {",
      '    expect(1).toBe(1);',
      '  });',
      '});',
      '',
    ].join('\n'),
  });
  // No vitest config, so it never reaches the report — it is here only so the
  // token `redis` names two packages and the matcher has to refuse to guess.
  writePackage('packages/shared/redis', '@other/redis', {});

  // Both sides, so one package heading has to carry two group headings.
  writePackage('packages/features/chat', '@sandbox/chat', {
    'vitest.config.backend.ts': [
      "import { backendProject } from '@acme/test-utils/vitest';",
      '',
      "export default backendProject({ webapp: 'sandbox' });",
      '',
    ].join('\n'),
    'vitest.config.frontend.ts': [
      "import { frontendProject } from '@acme/test-utils/vitest';",
      '',
      'export default frontendProject();',
      '',
    ].join('\n'),
    'src/tests/backend/integration/api/send.test.ts': [
      "describe('chat.send', () => {",
      "  it('persists a message', () => {",
      '    expect(1).toBe(1);',
      '  });',
      '});',
      '',
    ].join('\n'),
    'src/tests/frontend/unit/format.test.ts': [
      "describe('formatTimestamp', () => {",
      "  it('renders a relative time', () => {",
      '    expect(1).toBe(1);',
      '  });',
      '});',
      '',
    ].join('\n'),
  });

  // Baseline: with globalSetup running, the marker is written. This is what the
  // inventory run must not do.
  const listed = join(sandbox, 'direct.json');
  execFileSync(
    process.execPath,
    [
      join(repoRoot, 'node_modules/vitest/vitest.mjs'),
      'list',
      '--config',
      'vitest.config.backend.ts',
      `--json=${listed}`,
    ],
    {
      cwd: join(sandbox, 'packages/platform/p-one'),
      env: childEnv(),
      stdio: 'pipe',
    },
  );
  directNames = (
    JSON.parse(readFileSync(listed, 'utf8')) as { name: string }[]
  ).map((entry) => entry.name);
  globalSetupRanDirectly = existsSync(join(sandbox, MARKER));
  rmSync(join(sandbox, MARKER), { force: true });

  inventory = collect();
  byLayer = collect('--layer', 'backend');
  byKind = collect('--kind', 'unit');
  byKindViaPnpm = collect('--', '--kind', 'unit');
  byBoth = collect('--layer', 'backend', '--kind', 'unit');
  byEveryLayerAndKind = collect(
    '--layer',
    'backend,frontend',
    '--kind',
    'unit,integration',
  );
  const outPath = join(sandbox, 'inventory.md');
  outStdout = collect('--out', outPath);
  outFile = readFileSync(outPath, 'utf8');
}, 300_000);

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** The `## `/`### `/`#### ` headings, in the order they were printed. */
function headings(level: number, report = inventory) {
  const prefix = `${'#'.repeat(level)} `;
  return report
    .split('\n')
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length));
}

describe('pnpm test:inventory covers every package with tests', () => {
  it('groups packages by layer directory, in dependency order', () => {
    expect(headings(2).map((h) => h.split(' (')[0])).toEqual([
      'platform',
      'shared',
      'features',
    ]);
  });

  it('lists packages alphabetically within a layer, not by directory', () => {
    expect(headings(3).map((h) => h.split(' (')[0])).toEqual([
      '@sandbox/entitlements',
      '@sandbox/redis',
      '@sandbox/ui',
      '@sandbox/chat',
    ]);
  });

  it('gives a package with both sides one heading and a group for each', () => {
    const chat = inventory.slice(inventory.indexOf('### @sandbox/chat'));
    expect(chat).toContain('#### backend/integration/api');
    expect(chat).toContain('#### frontend/unit');
  });

  it('names the group segment as the path under src/tests', () => {
    expect(headings(4).map((h) => h.split(' (')[0])).toContain(
      'frontend/integration/components',
    );
  });
});

describe('pnpm test:inventory counts what it lists', () => {
  it('carries a test count in every heading', () => {
    const counted = [...headings(2), ...headings(3), ...headings(4)];
    expect(counted.length).toBeGreaterThan(0);
    for (const heading of counted) {
      expect(heading).toMatch(/\(\d+ tests?\)$/);
    }
  });

  it('ends on a total that matches the tests it printed', () => {
    const bullets = inventory
      .split('\n')
      .filter((line) => line.startsWith('- ')).length;
    const total = /\*\*Total: (\d+) tests in (\d+) packages\.\*\*/.exec(
      inventory,
    );
    expect(total?.[1]).toBe(String(bullets));
    expect(total?.[2]).toBe('4');
  });

  it('sums each package heading to the total', () => {
    const perPackage = headings(3).map((h) =>
      Number(/\((\d+) tests?\)$/.exec(h)?.[1]),
    );
    const total = Number(/\*\*Total: (\d+) tests/.exec(inventory)?.[1]);
    expect(perPackage.reduce((sum, n) => sum + n, 0)).toBe(total);
  });
});

describe('pnpm test:inventory reports what vitest reports', () => {
  it('lists the same tests vitest list gives for a package directly', () => {
    const redis = inventory.slice(
      inventory.indexOf('### @sandbox/redis'),
      inventory.indexOf('### @sandbox/ui'),
    );
    expect(directNames.length).toBeGreaterThan(0);
    for (const name of directNames) {
      expect(redis).toContain(`- ${name}`);
    }
  });

  it('resolves a computed name into the case it stands for', () => {
    expect(inventory).toContain('- nsKey > round-trips a read');
    expect(inventory).toContain('- nsKey > round-trips a write');
  });

  it('omits a skipped test, which vitest list collects as nothing to run', () => {
    // Not the tool's choice: `vitest list` (4.1) reports only tests whose mode
    // is run/only, so a `.skip` is invisible to it. The inventory is what
    // vitest says, so it is invisible here too — see the file header.
    expect(inventory).not.toContain('rejects a raw string');
  });
});

describe('pnpm test:inventory starts no infrastructure', () => {
  it('runs globalSetup when vitest lists the same package directly', () => {
    expect(globalSetupRanDirectly).toBe(true);
  });

  it('leaves globalSetup unrun, so no container and no schema push', () => {
    expect(existsSync(join(sandbox, MARKER))).toBe(false);
  });
});

describe('pnpm test:inventory narrows to the packages named', () => {
  it('lists one package and nothing else when given its full name', () => {
    const only = collect('@sandbox/redis');
    expect(only).toContain('### @sandbox/redis');
    for (const other of [
      '@sandbox/entitlements',
      '@sandbox/ui',
      '@sandbox/chat',
    ]) {
      expect(only).not.toContain(`### ${other}`);
    }
  });

  it('accepts the unscoped tail, as pnpm dev does for an app', () => {
    expect(collect('entitlements')).toBe(collect('@sandbox/entitlements'));
  });

  it('accepts the directory name too', () => {
    expect(collect('p-two')).toBe(collect('@sandbox/entitlements'));
  });

  it('takes several targets at once', () => {
    const both = collect('@sandbox/redis', '@sandbox/ui');
    expect(both).toContain('### @sandbox/redis');
    expect(both).toContain('### @sandbox/ui');
    expect(both).not.toContain('### @sandbox/chat');
  });

  it('counts only what the target contributed', () => {
    const total = /\*\*Total: (\d+) tests in (\d+) packages\.\*\*/.exec(
      collect('@sandbox/redis'),
    );
    expect(total?.[2]).toBe('1');
  });
});

describe('pnpm test:inventory rejects a target it cannot resolve', () => {
  it('exits non-zero naming the token, rather than printing an empty report', () => {
    const run = collectFailing('@sandbox/nope');
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('@sandbox/nope');
    expect(run.stdout).toBe('');
  });

  it('refuses to guess when a short name could mean two packages', () => {
    const run = collectFailing('redis');
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('@sandbox/redis');
    expect(run.stderr).toContain('@other/redis');
    expect(run.stdout).toBe('');
  });

  it('fails the whole run on one bad token among good ones', () => {
    const run = collectFailing('@sandbox/redis', '@sandbox/nope');
    expect(run.status).not.toBe(0);
    expect(run.stdout).toBe('');
  });
});

describe('pnpm test:inventory narrows to the layers and kinds asked for', () => {
  it('keeps only the layer named, dropping a package that has none of it', () => {
    expect(headings(4, byLayer).every((h) => h.startsWith('backend/'))).toBe(
      true,
    );
    // @sandbox/ui is frontend-only, so the narrowed report has no place for it.
    expect(headings(3, byLayer).map((h) => h.split(' (')[0])).toEqual([
      '@sandbox/entitlements',
      '@sandbox/redis',
      '@sandbox/chat',
    ]);
    expect(headings(2, byLayer).map((h) => h.split(' (')[0])).toEqual([
      'platform',
      'features',
    ]);
  });

  it('recounts every heading against the narrowed set', () => {
    // chat has one test on each side; under --layer backend it is worth one.
    const chat = headings(3, byLayer).find((h) =>
      h.startsWith('@sandbox/chat'),
    );
    expect(chat).toBe('@sandbox/chat (1 test)');
    const bullets = byLayer
      .split('\n')
      .filter((l) => l.startsWith('- ')).length;
    expect(byLayer).toContain(`**Total: ${bullets} tests in 3 packages.**`);
  });

  it('keeps only the kind named, across both layers', () => {
    expect(
      headings(4, byKind)
        .map((h) => h.split(' (')[0])
        .sort(),
    ).toEqual(['backend/unit', 'frontend/unit']);
  });

  it('reads the separator pnpm forwards as no argument at all', () => {
    expect(byKindViaPnpm).toBe(byKind);
  });

  it('reads that separator between a target and a flag too', () => {
    // `pnpm test:inventory chat -- --kind unit` puts it mid-argv, where
    // parseArgs would otherwise read the flags after it as more targets.
    expect(collect('@sandbox/chat', '--', '--kind', 'unit')).toBe(
      collect('@sandbox/chat', '--kind', 'unit'),
    );
  });

  it('intersects a target with a filter', () => {
    // The target picks the packages, the filter picks the tests within them.
    const chatBackend = collect('@sandbox/chat', '--layer', 'backend');
    expect(headings(3, chatBackend).map((h) => h.split(' (')[0])).toEqual([
      '@sandbox/chat',
    ]);
    expect(headings(4, chatBackend).map((h) => h.split(' (')[0])).toEqual([
      'backend/integration/api',
    ]);
  });

  it('reads a comma-separated list as every name in it', () => {
    expect(byEveryLayerAndKind).toBe(inventory);
  });

  it('composes the two flags as an intersection', () => {
    expect(headings(3, byBoth).map((h) => h.split(' (')[0])).toEqual([
      '@sandbox/redis',
    ]);
    expect(headings(4, byBoth).map((h) => h.split(' (')[0])).toEqual([
      'backend/unit',
    ]);
  });

  it('reports an empty inventory for a name nothing sits under', () => {
    const run = collectFailing('--layer', 'sideways');
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('**Total: 0 tests in 0 packages.**');
  });
});

describe('pnpm test:inventory writes to a file when asked', () => {
  it('puts the report in the file instead of on stdout', () => {
    expect(outStdout).toBe('');
    expect(outFile).toBe(inventory);
  });
});
