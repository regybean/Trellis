/**
 * Verifies `tooling/bank/src/bank-sync.mjs` — the pull half of the bank — against real
 * git repositories: a throwaway bank and a throwaway consumer, the script
 * copied in the way a consumer vendors it, and every assertion read back out of
 * git. The sandbox lives in `./bank-sandbox`, shared with the back-flow suite.
 *
 * Nothing is mocked — the point of the vendored-subset model
 * ([ADR 0037](../../../../../docs/adr/0037-vendored-git-subset-three-way-merge.md))
 * is what git itself does with the ancestry the script builds, so a fake git
 * would assert nothing.
 *
 * No container either: this package's vitest config has no global setup, and
 * nothing here needs one. Git and a temp dir are the whole fixture.
 */

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { Sandbox } from './bank-sandbox';
import {
  cleanupSandboxes,
  commit,
  editManifest,
  git,
  merge,
  numberedLines,
  read,
  repoRoot,
  runScript,
  setup,
  sync,
  treePaths,
  write,
  writeJson,
  writePackage,
} from './bank-sandbox';
import { readJson, stringMap } from './json';

/** The commands the root exposes for this package, all four delegated. */
const BANK_SCRIPTS = [
  'bank:contribute',
  'bank:sync',
  'check:bank-paths',
  'setup:wizard',
];

afterEach(cleanupSandboxes);

/**
 * Runs `--check`, returning its exit code and stdout. A non-zero exit is an
 * outcome here rather than a failure, so both paths come back the same shape.
 */
function check(consumer: string) {
  return runScript(consumer, 'tooling/bank/src/bank-sync.mjs', ['--check']);
}

/** Repoints the consumer's manifest at another bank ref. */
function pin(consumer: string, ref: string) {
  editManifest(consumer, { ref }, `consumer: pin ${ref}`);
}

/** Runs a sync expected to fail, returning its exit code and stderr. */
function syncFailure(consumer: string) {
  const run = runScript(consumer, 'tooling/bank/src/bank-sync.mjs');
  if (run.status === 0)
    throw new Error('expected bank:sync to fail, but it succeeded');
  return run;
}

/**
 * Reorganise the bank so the `docs` bundle's one prefix covers nothing.
 *
 * The bundle still names `docs`, and `docs/` no longer holds a tracked file, so
 * the prefix is now pointing at content the bank moved out from under its
 * subscribers — the failure the sync has to be loud about, because no
 * derivation would have caught it.
 */
function emptyDocsBundle({ bank }: Sandbox) {
  git(bank, ['rm', '-q', 'docs/guide.md']);
  commit(bank, 'bank: retire the docs directory');
}

function mergeFailure(consumer: string, extra: string[] = []) {
  try {
    merge(consumer, extra);
  } catch (error) {
    if (error instanceof Error && 'status' in error) {
      return Number(error.status);
    }
    throw error;
  }
  throw new Error('expected the merge to conflict, but it succeeded');
}

describe('bank:sync builds the vendor branch', () => {
  it('creates vendor/trellis holding exactly the resolved paths, and merges nothing', () => {
    const { consumer } = setup();
    const headBefore = git(consumer, ['rev-parse', 'HEAD']);

    const stdout = sync(consumer);

    // The two selected packages plus the always-included `root` bundle, and
    // nothing else: no app, no unselected bundle, no bank.paths.json.
    expect(treePaths(consumer, 'vendor/trellis')).toEqual([
      'pnpm-workspace.yaml',
      'tooling/eslint/index.js',
      'tooling/eslint/package.json',
      'tooling/prettier/index.js',
      'tooling/prettier/package.json',
      'turbo.json',
    ]);
    expect(stdout).toContain(
      'git merge --allow-unrelated-histories vendor/trellis',
    );

    // The working branch and tree are untouched: the sync only writes the ref.
    expect(git(consumer, ['rev-parse', 'HEAD'])).toBe(headBefore);
    expect(git(consumer, ['status', '--porcelain'])).toBe('');
    expect(git(consumer, ['branch', '--show-current'])).toBe('main');
  });

  it('parents the next sync on the previous one, so a merge replays only upstream changes', () => {
    const { bank, consumer } = setup();

    sync(consumer);
    const firstVendor = git(consumer, ['rev-parse', 'vendor/trellis']);
    merge(consumer, ['--allow-unrelated-histories']);

    write(
      bank,
      'tooling/prettier/index.js',
      'export default { semi: false };\n',
    );
    commit(bank, 'bank: prettier semi');

    const stdout = sync(consumer);
    expect(stdout).toContain('git merge vendor/trellis');
    expect(stdout).not.toContain('--allow-unrelated-histories');

    // Real ancestry: the previous vendor commit is the merge base.
    expect(git(consumer, ['rev-parse', 'vendor/trellis^'])).toBe(firstVendor);
    expect(git(consumer, ['merge-base', 'HEAD', 'vendor/trellis'])).toBe(
      firstVendor,
    );

    const beforeMerge = git(consumer, ['rev-parse', 'HEAD']);
    merge(consumer);

    expect(git(consumer, ['diff', '--name-only', beforeMerge, 'HEAD'])).toBe(
      'tooling/prettier/index.js',
    );
    expect(read(consumer, 'tooling/prettier/index.js')).toContain(
      'semi: false',
    );
    expect(read(consumer, 'apps/consumer/own.ts')).toContain('mine');
  });

  it('keeps both edits when the two sides touch different regions of one file', () => {
    const { bank, consumer } = setup();

    sync(consumer);
    merge(consumer, ['--allow-unrelated-histories']);

    write(
      consumer,
      'tooling/eslint/index.js',
      numberedLines('bank first', 'consumer changed the last line'),
    );
    commit(consumer, 'consumer: tweak the tail');

    write(
      bank,
      'tooling/eslint/index.js',
      numberedLines('bank changed the first line', 'bank last'),
    );
    commit(bank, 'bank: tweak the head');

    sync(consumer);
    merge(consumer);

    const merged = read(consumer, 'tooling/eslint/index.js');
    expect(merged).toContain('bank changed the first line');
    expect(merged).toContain('consumer changed the last line');
    expect(merged).not.toContain('<<<<<<<');
  });

  it('conflicts with markers when both sides edit the same lines', () => {
    const { bank, consumer } = setup();

    sync(consumer);
    merge(consumer, ['--allow-unrelated-histories']);

    write(
      consumer,
      'tooling/eslint/index.js',
      numberedLines('consumer owns the first line', 'bank last'),
    );
    commit(consumer, 'consumer: claim the head');

    write(
      bank,
      'tooling/eslint/index.js',
      numberedLines('bank rewrote the first line', 'bank last'),
    );
    commit(bank, 'bank: rewrite the head');

    sync(consumer);
    expect(mergeFailure(consumer)).not.toBe(0);

    const conflicted = read(consumer, 'tooling/eslint/index.js');
    expect(conflicted).toContain('<<<<<<<');
    expect(conflicted).toContain('consumer owns the first line');
    expect(conflicted).toContain('bank rewrote the first line');
    // Unmerged index entries — git stopped rather than picking a side.
    expect(git(consumer, ['ls-files', '--unmerged'])).not.toBe('');
  });

  it('fails naming a ref that does not exist upstream, leaving the vendor branch alone', () => {
    const { consumer } = setup();

    sync(consumer);
    const vendorBefore = git(consumer, ['rev-parse', 'vendor/trellis']);

    write(
      consumer,
      'bank.manifest.json',
      read(consumer, 'bank.manifest.json').replace('"main"', '"bank/nope"'),
    );

    const { status, stderr } = syncFailure(consumer);

    expect(status).not.toBe(0);
    expect(stderr).toContain('bank/nope');
    expect(git(consumer, ['rev-parse', 'vendor/trellis'])).toBe(vendorBefore);
  });

  /**
   * `upstream` and `ref` are the two manifest fields that reach git as
   * arguments of their own. A leading `-` moves them out of value position and
   * into option position, where git has options that run a command
   * (`--upload-pack`, `--exec`). The manifest is a file in the consumer's own
   * repo rather than a hostile input, but it is edited by hand and reviewed
   * like any other file, so the refusal belongs in the tool.
   */
  it.each([
    ['upstream', { upstream: '--upload-pack=touch ./pwned' }],
    ['ref', { ref: '--upload-pack=touch ./pwned' }],
  ])('refuses an %s that git would read as an option', (field, patch) => {
    const { consumer } = setup();

    editManifest(consumer, patch, `consumer: point ${field} at an option`);
    const { stderr } = syncFailure(consumer);

    expect(stderr).toContain(field);
    expect(stderr).toContain('git reads as an option');
    expect(existsSync(join(consumer, 'pwned'))).toBe(false);
  });
});

describe('bank:sync resolves the selection at the pinned ref', () => {
  /** The package directories a synced tree holds, deduped from its file paths. */
  function packageDirs(consumer: string) {
    return [
      ...new Set(
        treePaths(consumer, 'vendor/trellis')
          .filter((path) => path.endsWith('/package.json'))
          .map((path) => path.slice(0, -'/package.json'.length)),
      ),
    ].sort();
  }

  it('takes the full transitive workspace closure of a named package', () => {
    // @acme/db depends on @acme/logger, which devDepends on the eslint config.
    // None of those three paths is authored anywhere.
    const { consumer } = setup({ packages: ['@acme/db'] });

    sync(consumer);

    expect(packageDirs(consumer)).toEqual([
      'packages/db',
      'packages/logger',
      'tooling/eslint',
    ]);
  });

  it('adds the infra bundle when a closure member declares acme.infra', () => {
    const { consumer } = setup({ packages: ['@acme/db'] });

    sync(consumer);

    expect(treePaths(consumer, 'vendor/trellis')).toContain(
      'deploy/compose.yaml',
    );
  });

  it('leaves the infra bundle out when nothing in the closure declares it', () => {
    const { consumer } = setup({ packages: ['@acme/logger'] });

    sync(consumer);

    expect(treePaths(consumer, 'vendor/trellis')).not.toContain(
      'deploy/compose.yaml',
    );
  });

  it('takes a selected bundle and no unselected one', () => {
    const { consumer } = setup({ packages: [], bundles: ['docs'] });

    sync(consumer);

    const paths = treePaths(consumer, 'vendor/trellis');
    expect(paths).toContain('docs/guide.md');
    expect(paths).not.toContain('deploy/compose.yaml');
  });

  it('takes a bundle path that names a nested file, and only that file', () => {
    const { consumer } = setup({ packages: [], bundles: ['agents'] });

    sync(consumer);

    // `.claude/settings.json` is authored and travels; the generated symlinks
    // beside it are not named, so the prefix filter leaves them upstream.
    const paths = treePaths(consumer, 'vendor/trellis');
    expect(paths).toContain('.claude/settings.json');
    expect(paths).not.toContain('.claude/skills/generated.md');
  });

  it('takes the root bundle even for an empty selection', () => {
    const { consumer } = setup({ packages: [], bundles: [] });

    sync(consumer);

    expect(treePaths(consumer, 'vendor/trellis')).toEqual([
      'pnpm-workspace.yaml',
      'turbo.json',
    ]);
  });

  it('never offers a package the exclusions withhold', () => {
    const { consumer } = setup({ packages: ['@acme/web'] });

    const { status, stderr } = syncFailure(consumer);

    expect(status).toBe(1);
    expect(stderr).toContain('@acme/web');
    expect(git(consumer, ['branch', '--list', 'vendor/trellis'])).toBe('');
  });

  it('fails naming a selected package that does not exist at the ref, writing nothing', () => {
    const { consumer } = setup({ packages: ['@acme/logger'] });
    sync(consumer);
    const vendorBefore = git(consumer, ['rev-parse', 'vendor/trellis']);

    editManifest(consumer, { packages: ['@acme/logger', '@acme/nope'] });
    const { status, stderr } = syncFailure(consumer);

    expect(status).toBe(1);
    expect(stderr).toContain('@acme/nope');
    expect(git(consumer, ['rev-parse', 'vendor/trellis'])).toBe(vendorBefore);
  });

  it('subtracts an omitted closure path and warns that the tree will not install', () => {
    const { consumer } = setup({
      packages: ['@acme/db'],
      omit: ['packages/logger'],
    });

    const run = runScript(consumer, 'tooling/bank/src/bank-sync.mjs');

    expect(run.status).toBe(0);
    expect(packageDirs(consumer)).toEqual(['packages/db', 'tooling/eslint']);
    expect(run.stderr).toContain('packages/logger');
    expect(run.stderr).toContain('will not install unaided');
  });

  it('subtracts an omitted bundle file, the escape for a root file you already have', () => {
    const { consumer } = setup({ packages: [], omit: ['turbo.json'] });

    const run = runScript(consumer, 'tooling/bank/src/bank-sync.mjs');

    expect(run.status).toBe(0);
    expect(treePaths(consumer, 'vendor/trellis')).toEqual([
      'pnpm-workspace.yaml',
    ]);
    expect(run.stderr).toContain('turbo.json');
  });

  it('fails naming a bundle path the bank emptied, writing nothing', () => {
    const sandbox = setup({ packages: [], bundles: ['docs'] });
    sync(sandbox.consumer);
    const vendorBefore = git(sandbox.consumer, ['rev-parse', 'vendor/trellis']);

    emptyDocsBundle(sandbox);
    const { status, stderr } = syncFailure(sandbox.consumer);

    expect(status).toBe(1);
    expect(stderr).toContain('docs');
    expect(stderr).toContain('bundle "docs"');
    expect(git(sandbox.consumer, ['rev-parse', 'vendor/trellis'])).toBe(
      vendorBefore,
    );
  });

  it('keeps syncing a bundle path whose contents moved but still match', () => {
    const sandbox = setup({ packages: [], bundles: ['docs'] });
    sync(sandbox.consumer);

    // A reorganisation *inside* the subscribed prefix is what the derivation is
    // meant to absorb silently. Only an empty prefix is news.
    git(sandbox.bank, ['mv', 'docs/guide.md', 'docs/handbook.md']);
    commit(sandbox.bank, 'bank: rename the guide');
    sync(sandbox.consumer);

    expect(treePaths(sandbox.consumer, 'vendor/trellis')).toContain(
      'docs/handbook.md',
    );
  });
});

describe('bank:sync --check reports drift', () => {
  /** Pins the consumer to a tag, syncs and merges it, then moves the bank on. */
  function fallBehind(sandbox: Sandbox) {
    const { bank, consumer } = sandbox;
    git(bank, ['tag', 'bank/2026-01-01']);
    pin(consumer, 'bank/2026-01-01');
    sync(consumer);
    merge(consumer, ['--allow-unrelated-histories']);

    write(
      bank,
      'tooling/prettier/index.js',
      'export default { semi: false };\n',
    );
    write(bank, 'turbo.json', '{ "tasks": { "build": {} } }\n');
    commit(bank, 'bank: prettier semi and a build task');
  }

  it('exits 0 with a one-line all clear when up to date and unmodified', () => {
    const { consumer } = setup();
    sync(consumer);
    merge(consumer, ['--allow-unrelated-histories']);

    const { status, stdout } = check(consumer);

    expect(status).toBe(0);
    expect(stdout.trim().split('\n')).toHaveLength(1);
    expect(stdout).toContain('Up to date with main');
  });

  it('exits 2 naming the unpulled commit count and the subscribed paths that moved', () => {
    const sandbox = setup();
    fallBehind(sandbox);

    const { status, stdout } = check(sandbox.consumer);

    expect(status).toBe(2);
    expect(stdout).toContain('Behind by 1 bank commit.');
    expect(stdout).toContain('tooling/prettier (1 file)');
    expect(stdout).toContain('turbo.json (1 file)');
  });

  it('leaves the vendor branch, the working tree and the history untouched', () => {
    const sandbox = setup();
    fallBehind(sandbox);
    const { consumer } = sandbox;

    const before = {
      head: git(consumer, ['rev-parse', 'HEAD']),
      vendor: git(consumer, ['rev-parse', 'vendor/trellis']),
      commits: git(consumer, ['rev-list', '--count', '--all']),
    };

    expect(check(consumer).status).toBe(2);

    expect(git(consumer, ['rev-parse', 'HEAD'])).toBe(before.head);
    expect(git(consumer, ['rev-parse', 'vendor/trellis'])).toBe(before.vendor);
    expect(git(consumer, ['rev-list', '--count', '--all'])).toBe(
      before.commits,
    );
    expect(git(consumer, ['status', '--porcelain'])).toBe('');
  });

  it('lists a locally modified vendored path with the prompt to contribute it back', () => {
    const { consumer } = setup();
    sync(consumer);
    merge(consumer, ['--allow-unrelated-histories']);

    write(
      consumer,
      'tooling/eslint/index.js',
      numberedLines('bank first', 'consumer changed the last line'),
    );
    commit(consumer, 'consumer: tweak the tail');

    const { status, stdout } = check(consumer);

    // Still up to date with the bank — a local edit is a report, not a pull.
    expect(status).toBe(0);
    expect(stdout).toContain('Locally modified vendored paths:');
    expect(stdout).toContain('tooling/eslint/index.js');
    expect(stdout).toContain('contributing them back');
    // The consumer's own file is outside `include`, so it is not drift.
    expect(stdout).not.toContain('apps/consumer/own.ts');
  });

  it('does not mistake an unmerged sync for a local modification', () => {
    const { bank, consumer } = setup();
    sync(consumer);
    merge(consumer, ['--allow-unrelated-histories']);

    write(
      bank,
      'tooling/prettier/index.js',
      'export default { semi: false };\n',
    );
    commit(bank, 'bank: prettier semi');
    sync(consumer);

    const { stdout } = check(consumer);

    expect(stdout).not.toContain('Locally modified vendored paths:');
  });

  it('exits 2 saying the vendor branch is missing when nothing has synced', () => {
    const { consumer } = setup();

    const { status, stdout } = check(consumer);

    expect(status).toBe(2);
    expect(stdout).toContain('vendor/trellis does not exist');
  });

  it('names the paths entering and leaving the closure at the bank tip', () => {
    const { bank, consumer } = setup({ packages: ['@acme/db'] });
    git(bank, ['tag', 'bank/2026-01-01']);
    pin(consumer, 'bank/2026-01-01');
    sync(consumer);
    merge(consumer, ['--allow-unrelated-histories']);

    // Upstream, db swaps its logger dependency for a new cache package. Neither
    // path is in any manifest, so --check is the only place this surfaces.
    writePackage(bank, 'packages/cache', {
      name: '@acme/cache',
      version: '0.0.0',
    });
    writePackage(bank, 'packages/db', {
      name: '@acme/db',
      version: '0.0.0',
      dependencies: { '@acme/cache': 'workspace:*', postgres: 'catalog:' },
      acme: { infra: ['postgres'] },
    });
    commit(bank, 'bank: db moves from logger to cache');

    const { status, stdout } = check(consumer);

    expect(status).toBe(2);
    expect(stdout).toContain('+ packages/cache');
    expect(stdout).toContain('- packages/logger');
  });

  it('reports a bundle path the bank emptied rather than refusing to look', () => {
    const sandbox = setup({ packages: [], bundles: ['docs'] });
    git(sandbox.bank, ['tag', 'bank/2026-01-01']);
    pin(sandbox.consumer, 'bank/2026-01-01');
    sync(sandbox.consumer);
    merge(sandbox.consumer, ['--allow-unrelated-histories']);

    emptyDocsBundle(sandbox);
    const { status, stdout } = check(sandbox.consumer);

    // Telling the human a bump would break is the whole job, so --check resolves
    // non-strictly and reports where a sync aborts. It stays the behind outcome.
    expect(status).toBe(2);
    expect(stdout).toContain('match nothing at the bank tip');
    expect(stdout).toContain('bundle "docs"');
  });

  it('exits 1 on an error, distinct from both other outcomes', () => {
    const { consumer } = setup();
    sync(consumer);
    merge(consumer, ['--allow-unrelated-histories']);
    pin(consumer, 'bank/nope');

    expect(check(consumer).status).toBe(1);
  });

  /**
   * Those three codes only mean anything if they survive the root script, so
   * the delegation is exercised rather than read.
   *
   * The command under test is copied verbatim out of this repo's root
   * `package.json` into a throwaway workspace, where `tooling/bank` is a stub
   * that exits 2 on demand and can be deleted. Nothing here asserts a spelling:
   * both `pnpm -C tooling/bank` and `pnpm --filter @acme/bank` reach that stub,
   * and either is free to pass if it behaves.
   *
   * The second case is the one that separates them, and it is the reason the
   * root uses `-C`. `--filter` on a name no package matches prints "No projects
   * matched the filters" and exits **0**: in a repo whose bank never arrived —
   * the failure the always-included bundle exists to prevent, one registration
   * away at all times — `pnpm bank:sync --check` would answer "no drift" having
   * looked at nothing. `-C` on a missing directory is an error.
   */
  describe('the root delegation', () => {
    const rootScripts = stringMap(
      readJson(join(repoRoot, 'package.json')),
      'scripts',
    );

    /**
     * The bank commands the root manifest actually defines.
     *
     * In the bank that is all four, asserted below: the bank authors the
     * manifest every consumer receives, so a missing entry here is its own
     * defect. A vendored copy is the consumer's to edit, and one of the four
     * can do nothing in their repo — `check:bank-paths` has no inventory to
     * enforce outside a bank and says so — so deleting it is tidying, and the
     * case it feeds is absent there rather than red. What a consumer must
     * *keep* is bootstrap.test.ts's rule, derived from the bundles.
     */
    const declared = BANK_SCRIPTS.filter((script) => script in rootScripts);
    const isBank = existsSync(join(repoRoot, 'bank.paths.json'));

    it.skipIf(!isBank)(
      isBank
        ? 'is declared for every bank command at the root'
        : "is declared for every bank command at the root — skipped: needs the bank's own root manifest, the one it authors rather than one it vendored",
      () => {
        expect(declared).toEqual(BANK_SCRIPTS);
      },
    );

    const delegated: string[] = [];

    afterEach(() => {
      for (const dir of delegated.splice(0)) rmSync(dir, { recursive: true });
    });

    /** The real root command, over a stub bank that exits `code`. */
    function scratchWorkspace(script: string, code: number, bank = true) {
      const command = rootScripts[script] ?? '';
      expect(command, `root package.json defines ${script}`).not.toBe('');

      const dir = mkdtempSync(join(tmpdir(), 'bank-delegation-'));
      delegated.push(dir);

      writeJson(join(dir, 'package.json'), {
        name: 'scratch-consumer',
        private: true,
        scripts: { [script]: command },
      });
      writeFileSync(
        join(dir, 'pnpm-workspace.yaml'),
        'packages:\n  - tooling/*\n',
      );

      if (bank) {
        mkdirSync(join(dir, 'tooling/bank'), { recursive: true });
        writeJson(join(dir, 'tooling/bank/package.json'), {
          name: '@acme/bank',
          private: true,
          scripts: Object.fromEntries(
            BANK_SCRIPTS.map((name) => [
              name,
              `node -e "process.exit(${code})"`,
            ]),
          ),
        });
      }

      return dir;
    }

    /** Runs the root command the way a human at the repo root would. */
    function runRoot(dir: string, script: string) {
      const run = spawnSync('pnpm', ['run', script], {
        cwd: dir,
        encoding: 'utf8',
      });
      if (run.error) throw run.error;
      return run.status ?? -1;
    }

    it.each(declared)(
      'passes %s the exit code its package returned, not one of its own',
      (script) => {
        const dir = scratchWorkspace(script, 2);

        expect(runRoot(dir, script)).toBe(2);
      },
    );

    it('fails rather than reporting success when the bank package is absent', () => {
      const dir = scratchWorkspace('bank:sync', 2, false);

      expect(
        runRoot(dir, 'bank:sync'),
        'a root command that no-ops to 0 when the bank is missing would report "no drift" having looked at nothing',
      ).not.toBe(0);
    });
  });
});
