/**
 * Verifies `tooling/bank/src/check-bank-paths.mjs` against throwaway repos in a temp dir.
 *
 * The gate it runs in is a completeness rule over a whole repository — every
 * tracked root-level entry is in a bundle, on `exclude`, or is a workspace root
 * — so a case is a real git repo with real tracked files, the way
 * `check-adrs.test.ts` and `bank-sandbox` do it. Nothing is stubbed: the
 * checker enumerates with `git ls-files`.
 *
 * Two of these cases are about the checker *finding* the repo rather than about
 * the rule, and they carry the most weight. A checker aimed at the wrong
 * directory finds no inventory, takes the consumer-repo branch and exits 0 —
 * green, and enforcing nothing. That failure is silent by construction, so it
 * has to be tested from a depth other than the one the checker ships at.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
// src/tests/backend -> repo root is five levels up.
const repoRoot = resolve(here, '../../../../../');
const CHECKER = join(repoRoot, 'tooling/bank/src/check-bank-paths.mjs');

/** The checker plus the libs it imports by relative path, as one movable unit. */
const CHECKER_FILES = [
  'check-bank-paths.mjs',
  'lib/bank.mjs',
  'lib/bank-closure.mjs',
];

const sandboxes: string[] = [];

afterEach(() => {
  for (const dir of sandboxes.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

const inventory = (
  bundles: { name: string; paths: string[] }[],
  exclude: string[],
) =>
  `${JSON.stringify(
    {
      version: 1,
      bundles: bundles.map((bundle) => ({ ...bundle, alwaysIncluded: true })),
      exclude: exclude.map((path) => ({
        path,
        reason: 'A consumer never takes it.',
      })),
    },
    null,
    2,
  )}\n`;

/**
 * The shape every case starts from: a repo whose every root-level entry is
 * classified one of the three permitted ways.
 *
 * `pnpm-workspace.yaml` and `bank.paths.json` are themselves root-level
 * entries, so a fixture that forgets to classify them fails for a reason that
 * has nothing to do with the case being written.
 */
function baseline(): Record<string, string> {
  return {
    'pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
    'bank.paths.json': inventory(
      [{ name: 'root', paths: ['package.json', 'pnpm-workspace.yaml'] }],
      ['README.md', 'bank.paths.json'],
    ),
    'package.json': '{ "name": "fixture" }\n',
    'README.md': '# fixture\n',
    'packages/alpha/package.json': '{ "name": "@fixture/alpha" }\n',
  };
}

/** A throwaway repo holding exactly `files`, staged so `git ls-files` sees it. */
function sandbox(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'check-bank-paths-'));
  sandboxes.push(dir);

  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }

  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: dir,
      env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' },
    });
  git('init', '-q', '--initial-branch=main');
  git('add', '-A');

  return dir;
}

/**
 * Copy the checker into `dir` at `at` — any depth, not the one it ships at.
 * The relative `./lib/` imports come along, so what runs is the real file.
 */
function relocate(dir: string, at: string) {
  for (const file of CHECKER_FILES) {
    const target = join(dir, at, file);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(repoRoot, 'tooling/bank/src', file), target);
  }
  return join(at, 'check-bank-paths.mjs');
}

/** Runs a checker, returning its exit code and both streams merged. */
function run(script: string, args: string[] = [], cwd = repoRoot) {
  const result = spawnSync('node', [script, ...args], {
    cwd,
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  return {
    status: result.status,
    output: result.stdout + result.stderr,
  };
}

describe('check-bank-paths enforces the inventory', () => {
  it('passes a repo whose every root entry is classified', () => {
    const dir = sandbox(baseline());

    const { status, output } = run(CHECKER, [dir]);

    expect(status).toBe(0);
    // The count proves it read the fixture rather than the repo it lives in.
    expect(output).toContain('all 5 tracked root-level entries are classified');
  });

  it('fails naming a tracked root entry in no bundle and no exclusion', () => {
    const dir = sandbox({ ...baseline(), 'CHANGELOG.md': '# changes\n' });

    const { status, output } = run(CHECKER, [dir]);

    expect(status).toBe(1);
    expect(output).toContain('CHANGELOG.md');
    expect(output).toContain('does not classify 1 tracked root-level entry');
  });

  it('accepts a bundle path nested inside the root entry it classifies', () => {
    // The real inventory's `scaffolding` names `turbo/generators` while the
    // root entry is `turbo`. Covering it is what stops the rule from forcing
    // bundles to be coarser than the concern they describe.
    const dir = sandbox({
      ...baseline(),
      'bank.paths.json': inventory(
        [
          { name: 'root', paths: ['package.json', 'pnpm-workspace.yaml'] },
          { name: 'scaffolding', paths: ['turbo/generators'] },
        ],
        ['README.md', 'bank.paths.json'],
      ),
      'turbo/generators/config.ts': 'export default {};\n',
    });

    const { status } = run(CHECKER, [dir]);

    expect(status).toBe(0);
  });
});

describe('check-bank-paths finds the repo root', () => {
  it('enforces the inventory from a depth other than the one it ships at', () => {
    const dir = sandbox({ ...baseline(), 'CHANGELOG.md': '# changes\n' });
    const relocated = relocate(dir, 'tooling/bank/src');

    // No root argument: the only thing that can find the repo here is git, and
    // the depth calculation this replaced would have resolved to `tooling/bank`.
    const { status, output } = run(relocated, [], dir);

    expect(status).toBe(1);
    expect(output).toContain('CHANGELOG.md');
  });

  it('finds it from a subdirectory too, not just from the root', () => {
    const dir = sandbox({ ...baseline(), 'CHANGELOG.md': '# changes\n' });
    const relocated = relocate(dir, 'tooling/bank/src');

    const { status, output } = run(
      join(dir, relocated),
      [],
      join(dir, 'packages/alpha'),
    );

    expect(status).toBe(1);
    expect(output).toContain('CHANGELOG.md');
  });

  it('no-ops and exits 0 in a consumer repo, which has no inventory', () => {
    const consumer = baseline();
    delete consumer['bank.paths.json'];
    const dir = sandbox(consumer);
    const relocated = relocate(dir, 'tooling/bank/src');

    const { status, output } = run(relocated, [], dir);

    expect(status).toBe(0);
    expect(output).toContain('this repo is not a bank');
  });
});

/**
 * The distribution invariant behind this package existing at all, asserted
 * against the real `bank.paths.json` rather than a fixture.
 *
 * Root `package.json` is itself `root`-bundle content, so a consumer receives
 * our script entries whether or not they receive what those entries invoke. A
 * root command delegated into a **tooling** package therefore has to name a
 * package that arrives with an always-included bundle — otherwise a consumer
 * whose manifest never selected it syncs a `package.json` calling a package it
 * does not have. For the bank the first casualty is the command that performs
 * their next sync, which is why this is a test and not a comment.
 *
 * Scoped to `tooling/` deliberately. The root also carries a few conveniences
 * that delegate into feature packages (`studio`, `seed:localstripe`,
 * `lint:mastra`); those name content a consumer chooses, and a selection that
 * omits the feature is meant to leave the script dangling rather than drag the
 * whole slice in. A repo *command* is not optional in the same way.
 *
 * Derived from the manifests rather than a list here, so it keeps holding as
 * the rest of `scripts/` moves into tooling packages (#314).
 */
describe('every delegated tooling command arrives with the root bundle', () => {
  /**
   * Workspace package name -> its repo-relative directory.
   *
   * `--others --exclude-standard` alongside the index, so a package added in
   * the working tree counts before it is committed — otherwise the rule silently
   * skips exactly the package a move is in the middle of introducing. Ignored
   * paths stay out, which is what keeps `node_modules` from being walked.
   */
  const packageDirs = new Map(
    execFileSync(
      'git',
      [
        'ls-files',
        '-z',
        '--cached',
        '--others',
        '--exclude-standard',
        '*/package.json',
      ],
      { cwd: repoRoot, encoding: 'utf8' },
    )
      .split('\0')
      .filter(Boolean)
      .map((manifest) => {
        const { name } = JSON.parse(
          readFileSync(join(repoRoot, manifest), 'utf8'),
        ) as { name?: string };
        return [name, dirname(manifest)] as const;
      })
      .filter((entry): entry is readonly [string, string] => Boolean(entry[0])),
  );

  const alwaysIncluded = (
    JSON.parse(readFileSync(join(repoRoot, 'bank.paths.json'), 'utf8')) as {
      bundles: { alwaysIncluded?: boolean; paths: string[] }[];
    }
  ).bundles
    .filter((bundle) => bundle.alwaysIncluded)
    .flatMap((bundle) => bundle.paths);

  const { scripts } = JSON.parse(
    readFileSync(join(repoRoot, 'package.json'), 'utf8'),
  ) as { scripts: Record<string, string> };

  const delegated = [
    ...new Set(
      Object.values(scripts).flatMap(
        (command) => /--filter\s+(@[\w-]+\/[\w-]+)/.exec(command)?.[1] ?? [],
      ),
    ),
  ]
    .sort()
    .filter((name) => packageDirs.get(name)?.startsWith('tooling/'));

  it('delegates at least the bank commands, so the rule has something to bind', () => {
    expect(delegated).toContain('@acme/bank');
  });

  it.each(delegated)('%s is covered by an always-included bundle', (name) => {
    const dir = packageDirs.get(name);

    const covering = alwaysIncluded.filter(
      (prefix) => dir === prefix || dir?.startsWith(`${prefix}/`),
    );

    expect(
      covering,
      `root package.json delegates to ${name} (${String(dir)}), but no always-included bundle path covers it — a consumer would sync a package.json calling a package it never received`,
    ).not.toEqual([]);
  });
});
