/**
 * Verifies `tooling/bank/src/check-bank-tokens.mjs` against throwaway repos.
 *
 * The rule is a question about a whole repository — what is distributable, and
 * what this repo is called — so a case is a real git repo with real tracked
 * files and a real remote, the way `check-bank-paths.test.ts` does it. Nothing
 * is stubbed: the checker enumerates with `git ls-files` and asks git for the
 * remote.
 *
 * Three cases carry the weight. The allowlist, because `docs/bank.md` is
 * addressed to a consumer about consuming this repo and naming it there is
 * correct — a checker that flagged it would train the reader to ignore the
 * report. The derivation of what is distributable, because it comes from
 * `exclude` rather than a list here: content withheld from every consumer is
 * free to name whatever it likes. And the root manifest's script entries, which
 * are the one *line*-level exemption, so the rest of that same file stays in
 * scope.
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
    'package.json': `${JSON.stringify(
      {
        name: 'fixture',
        scripts: {
          'build:storefront': 'turbo run build -F @fixture/storefront',
        },
      },
      null,
      2,
    )}\n`,
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

  it('reads a patch body, which ships and lands in a dependency', () => {
    // A patch is distributable content twice over: it arrives in the
    // always-included bundle, and its added lines are injected into the
    // consumer's node_modules. An extension left off the scanned list is an
    // allowlist nobody wrote down.
    const { stderr } = run({
      ...baseline(),
      'patches/dep@1.0.0.patch': '+// Vendored from Widgets.\n',
    });

    expect(stderr).toContain('patches/dep@1.0.0.patch:1');
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
      'docs/guide.md': 'The storefronts endpoint is not an app.\n',
    });

    expect(stderr).toBe('');
  });

  it('reads a hyphenated compound as naming what is inside it', () => {
    // The false negative this rule ran with for its whole report-only period
    // and beyond: a hyphen counted as a word character, so every compound built
    // out of a name — `dev-<app>.log`, `<repo>-postgres`, `<repo>-<app>` — read
    // as a word naming nobody. The gate reported zero while the repo carried
    // its own name into an always-included bundle.
    const { stderr } = run({
      ...baseline(),
      'docs/guide.md':
        'Tail `logs/dev-storefront.log`, then `Widgets-postgres`.\n',
    });

    expect(stderr).toContain('docs/guide.md:1');
    expect(stderr).toContain('storefront');
    expect(stderr).toContain('Widgets');
  });
});

describe('the two compounds a name is allowed to sit in', () => {
  it('leaves a package published under somebody else s scope alone', () => {
    // `@t3-oss/env-nextjs` is that package's name. A consumer installs the same
    // string whatever they call their apps, so it names nothing about us.
    const { status, stderr } = run({
      ...baseline(),
      'docs/guide.md': 'Built on `@t3-oss/env-storefront`, not the core one.\n',
    });

    expect(status).toBe(0);
    expect(stderr).toBe('');
  });

  it('still reports our own scope, which is the thing they will not have', () => {
    const { stderr } = run({
      ...baseline(),
      'docs/guide.md': 'Mounted by `@fixture/storefront`.\n',
    });

    expect(stderr).toContain('docs/guide.md:1');
  });

  it('leaves a default the consumer can override from the environment', () => {
    // The name is a fallback, replaced by exporting the variable, so the file
    // runs correctly in their repo without an edit.
    const { status, stderr } = run({
      ...baseline(),
      'scripts/run.sh': 'PREFIX="${INFRA_CONTAINER_PREFIX:-Widgets-}"\n',
    });

    expect(status).toBe(0);
    expect(stderr).toBe('');
  });

  it('still reports a bare literal, which there is nothing to set', () => {
    const { stderr } = run({
      ...baseline(),
      'scripts/run.sh': 'PREFIX="Widgets-"\n',
    });

    expect(stderr).toContain('scripts/run.sh:1');
  });

  it('reports the other occurrence on a line that carries both', () => {
    // The exemptions are positions, not a verdict on the line: one occurrence
    // can be an upstream package and the next the repo itself.
    const { stderr } = run({
      ...baseline(),
      'docs/guide.md': 'Built on `@t3-oss/env-storefront` for `Widgets`.\n',
    });

    expect(stderr).toContain('docs/guide.md:1');
    expect(stderr).toContain('Widgets');
  });

  it('fails, and prints the count', () => {
    const { status, stderr } = run({
      ...baseline(),
      'docs/guide.md': 'Widgets, by octocat.\n',
    });

    expect(status).toBe(1);
    expect(stderr).toContain('2 distributable lines name');
  });
});

describe('what it leaves alone', () => {
  it('allows docs/bank.md, which is addressed to a consumer about this repo', () => {
    const { stderr } = run(baseline());

    expect(stderr).not.toContain('docs/bank.md');
  });

  it('allows a root manifest script entry, which is one line to delete', () => {
    // The baseline manifest has a `build:storefront` entry naming the app.
    const { status, stderr } = run(baseline());

    expect(status).toBe(0);
    expect(stderr).not.toContain('package.json');
  });

  it('still reads the rest of the root manifest', () => {
    const { stderr } = run({
      ...baseline(),
      'package.json': `${JSON.stringify(
        { name: 'fixture', description: 'Vendored from Widgets.' },
        null,
        2,
      )}\n`,
    });

    expect(stderr).toContain('package.json:');
  });

  it('does not lend the exemption to a dependency of the same name', () => {
    // The exemption is per line and keyed on script names, so it has to be
    // bounded to the `scripts` block — otherwise a dependency that happens to
    // share a name with a script inherits an argument written for something
    // else entirely.
    const { status, stderr } = run({
      ...baseline(),
      'package.json': `${JSON.stringify(
        {
          name: 'fixture',
          scripts: { 'build:storefront': 'turbo run build' },
          devDependencies: { 'build:storefront': 'Widgets' },
        },
        null,
        2,
      )}\n`,
    });

    expect(status).toBe(1);
    expect(stderr).toContain('package.json:');
  });

  it('bounds the exemption by key position, not by braces in a script body', () => {
    // A script body is a shell command, so it holds braces and brackets of its
    // own. Tracking depth over the raw text counts those too: one unbalanced
    // bracket moves where the block is thought to end, and the exemption
    // silently covers — or stops covering — the wrong lines. Here the body is
    // deliberately unbalanced and the offending line sits after `scripts`.
    const { status, stderr } = run({
      ...baseline(),
      'package.json': `${JSON.stringify(
        {
          name: 'fixture',
          scripts: {
            'build:storefront': 'turbo run build -F @fixture/storefront',
            ci: '[ -n "$CI" ] && echo }}} || echo {{{',
          },
          description: 'Vendored from Widgets.',
        },
        null,
        2,
      )}\n`,
    });

    // Exactly one: the description. The script entries stay exempt, and the
    // unbalanced body neither un-exempts them nor swallows the line after.
    expect(status).toBe(1);
    expect(stderr).toContain('package.json:');
    expect(stderr).toContain('1 distributable lines name');
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
