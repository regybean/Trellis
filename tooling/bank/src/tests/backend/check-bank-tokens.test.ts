/**
 * Verifies `tooling/bank/src/check-bank-tokens.mjs` against throwaway repos.
 *
 * The rule is a question about a whole repository — what is distributable, and
 * what this repo is called — so a case is a real git repo with real tracked
 * files and a real remote, the way `check-bank-paths.test.ts` does it. Nothing
 * is stubbed: the checker enumerates with `git ls-files` and asks git for the
 * remote.
 *
 * Two cases carry the weight. The allowlist, because `docs/bank.md` is
 * addressed to a consumer about consuming this repo and naming it there is
 * correct — a checker that flagged it would train the reader to ignore the
 * report. And the derivation of what is distributable, because it comes from
 * `exclude` rather than a list here: content withheld from every consumer is
 * free to name whatever it likes.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
// src/tests/backend -> repo root is five levels up.
const repoRoot = resolve(here, '../../../../../');
const CHECKER = join(repoRoot, 'tooling/bank/src/check-bank-tokens.mjs');

const sandboxes: string[] = [];

afterEach(() => {
  for (const dir of sandboxes.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

const inventory = (exclude: string[]) =>
  `${JSON.stringify(
    {
      version: 1,
      bundles: [
        {
          name: 'root',
          alwaysIncluded: true,
          paths: ['package.json', 'docs'],
        },
      ],
      exclude: exclude.map((path) => ({
        path,
        reason: 'A consumer never takes it.',
      })),
    },
    null,
    2,
  )}\n`;

/** A bank owned by `octocat`, called `Widgets`, with one app called `storefront`. */
function baseline(): Record<string, string> {
  return {
    'bank.paths.json': inventory(['apps', 'bank.paths.json', 'README.md']),
    'package.json': '{ "name": "fixture" }\n',
    'README.md': '# Widgets, by octocat\n',
    'docs/bank.md': '# Taking Widgets\n\nSync from octocat/Widgets.\n',
    'docs/guide.md': '# The guide\n\nNothing here names anybody.\n',
    'apps/storefront/package.json': '{ "name": "@fixture/storefront" }\n',
  };
}

/** A throwaway repo holding exactly `files`, staged and with a remote. */
function sandbox(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'check-bank-tokens-'));
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
  // The only place a repo is told its own name.
  git('remote', 'add', 'origin', 'git@github.com:octocat/Widgets.git');
  git('add', '-A');

  return dir;
}

/** Runs the checker, returning its exit code and both streams. */
function run(files: Record<string, string>, args: string[] = []) {
  const result = spawnSync('node', [CHECKER, sandbox(files), ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    output: result.stdout + result.stderr,
  };
}

describe('what the checker treats as this repo', () => {
  it('derives the owner, the repo and every app', () => {
    const { stdout } = run(baseline());

    for (const token of [
      'octocat',
      'Widgets',
      'storefront',
      '@fixture/storefront',
    ]) {
      expect(stdout).toContain(token);
    }
  });
});

describe('distributable content naming this repo', () => {
  it.each([
    ['the repo', 'Vendored from Widgets.'],
    ['the owner', 'Fetched from octocat.'],
    ['an app directory name', 'Mounted by storefront.'],
    ['an app package name', 'Mounted by @fixture/storefront.'],
    ['a slug', 'See github.com/octocat/Widgets for the source.'],
  ])('reports %s', (_what, line) => {
    const { stderr } = run({ ...baseline(), 'docs/guide.md': `${line}\n` });

    expect(stderr).toContain('docs/guide.md:1');
  });

  it('reports nothing when the same content names none of them', () => {
    const { status, stdout, stderr } = run(baseline());

    expect(status).toBe(0);
    expect(stderr).toBe('');
    expect(stdout).toContain('nothing distributable names');
  });

  it('matches a name whole, not as a substring of a longer word', () => {
    const { stderr } = run({
      ...baseline(),
      'docs/guide.md': 'The storefront-canary spike is not an app.\n',
    });

    expect(stderr).toBe('');
  });

  it('reports without failing, and prints the count', () => {
    const { status, stdout } = run({
      ...baseline(),
      'docs/guide.md': 'Widgets, by octocat.\n',
    });

    expect(status).toBe(0);
    expect(stdout).toContain('2 distributable lines name');
    expect(stdout).toContain('not failing the gate yet');
  });
});

describe('what it leaves alone', () => {
  it('allows docs/bank.md, which is addressed to a consumer about this repo', () => {
    const { stderr } = run(baseline());

    expect(stderr).not.toContain('docs/bank.md');
  });

  it('ignores content `exclude` withholds from every consumer', () => {
    // README.md names both, and is on `exclude`.
    const { stderr } = run(baseline());

    expect(stderr).not.toContain('README.md');
  });

  it('reports the same content once it becomes distributable', () => {
    const { stderr } = run({
      ...baseline(),
      'bank.paths.json': inventory(['apps', 'bank.paths.json']),
    });

    expect(stderr).toContain('README.md:1');
  });
});

describe('a consumer repo, which has no inventory', () => {
  it('no-ops and exits 0', () => {
    const consumer = baseline();
    delete consumer['bank.paths.json'];

    const { status, output } = run(consumer);

    expect(status).toBe(0);
    expect(output).toContain('this repo is not a bank');
  });
});
