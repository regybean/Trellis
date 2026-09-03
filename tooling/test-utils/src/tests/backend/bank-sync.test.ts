/**
 * Verifies `scripts/bank-sync.mjs` — the pull half of the bank — against real
 * git repositories: a throwaway bank and a throwaway consumer, the script
 * copied in the way a consumer vendors it, and every assertion read back out of
 * git. The sandbox lives in `./bank-sandbox`, shared with the back-flow suite.
 *
 * Nothing is mocked — the point of the vendored-subset model
 * ([ADR 0037](../../../../../docs/adr/0037-vendored-git-subset-three-way-merge.md))
 * is what git itself does with the ancestry the script builds, so a fake git
 * would assert nothing.
 *
 * No container is needed here. The suite's global-setup starts LocalStack for
 * the sibling secrets test; this file uses none of it.
 */

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
  runScript,
  setup,
  sync,
  treePaths,
  write,
} from './bank-sandbox';

afterEach(cleanupSandboxes);

/**
 * Runs `--check`, returning its exit code and stdout. A non-zero exit is an
 * outcome here rather than a failure, so both paths come back the same shape.
 */
function check(consumer: string) {
  return runScript(consumer, 'scripts/bank-sync.mjs', ['--check']);
}

/** Repoints the consumer's manifest at another bank ref. */
function pin(consumer: string, ref: string) {
  editManifest(consumer, { ref }, `consumer: pin ${ref}`);
}

/** Runs a sync expected to fail, returning its exit code and stderr. */
function syncFailure(consumer: string) {
  const run = runScript(consumer, 'scripts/bank-sync.mjs');
  if (run.status === 0)
    throw new Error('expected bank:sync to fail, but it succeeded');
  return run;
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
  it('creates vendor/trellis holding exactly the include paths, and merges nothing', () => {
    const { consumer } = setup();
    const headBefore = git(consumer, ['rev-parse', 'HEAD']);

    const stdout = sync(consumer);

    expect(treePaths(consumer, 'vendor/trellis')).toEqual([
      'tooling/eslint.js',
      'tooling/prettier.js',
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

    write(bank, 'tooling/prettier.js', 'export default { semi: false };\n');
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
      'tooling/prettier.js',
    );
    expect(read(consumer, 'tooling/prettier.js')).toContain('semi: false');
    expect(read(consumer, 'apps/consumer/own.ts')).toContain('mine');
  });

  it('keeps both edits when the two sides touch different regions of one file', () => {
    const { bank, consumer } = setup();

    sync(consumer);
    merge(consumer, ['--allow-unrelated-histories']);

    write(
      consumer,
      'tooling/eslint.js',
      numberedLines('bank first', 'consumer changed the last line'),
    );
    commit(consumer, 'consumer: tweak the tail');

    write(
      bank,
      'tooling/eslint.js',
      numberedLines('bank changed the first line', 'bank last'),
    );
    commit(bank, 'bank: tweak the head');

    sync(consumer);
    merge(consumer);

    const merged = read(consumer, 'tooling/eslint.js');
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
      'tooling/eslint.js',
      numberedLines('consumer owns the first line', 'bank last'),
    );
    commit(consumer, 'consumer: claim the head');

    write(
      bank,
      'tooling/eslint.js',
      numberedLines('bank rewrote the first line', 'bank last'),
    );
    commit(bank, 'bank: rewrite the head');

    sync(consumer);
    expect(mergeFailure(consumer)).not.toBe(0);

    const conflicted = read(consumer, 'tooling/eslint.js');
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
});

describe('bank:sync --check reports drift', () => {
  /** Pins the consumer to a tag, syncs and merges it, then moves the bank on. */
  function fallBehind(sandbox: Sandbox) {
    const { bank, consumer } = sandbox;
    git(bank, ['tag', 'bank/2026-01-01']);
    pin(consumer, 'bank/2026-01-01');
    sync(consumer);
    merge(consumer, ['--allow-unrelated-histories']);

    write(bank, 'tooling/prettier.js', 'export default { semi: false };\n');
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

  it('exits 2 naming the unpulled commit count and the include paths that moved', () => {
    const sandbox = setup();
    fallBehind(sandbox);

    const { status, stdout } = check(sandbox.consumer);

    expect(status).toBe(2);
    expect(stdout).toContain('Behind by 1 bank commit.');
    expect(stdout).toContain('tooling (1 file)');
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
      'tooling/eslint.js',
      numberedLines('bank first', 'consumer changed the last line'),
    );
    commit(consumer, 'consumer: tweak the tail');

    const { status, stdout } = check(consumer);

    // Still up to date with the bank — a local edit is a report, not a pull.
    expect(status).toBe(0);
    expect(stdout).toContain('Locally modified vendored paths:');
    expect(stdout).toContain('tooling/eslint.js');
    expect(stdout).toContain('contributing them back');
    // The consumer's own file is outside `include`, so it is not drift.
    expect(stdout).not.toContain('apps/consumer/own.ts');
  });

  it('does not mistake an unmerged sync for a local modification', () => {
    const { bank, consumer } = setup();
    sync(consumer);
    merge(consumer, ['--allow-unrelated-histories']);

    write(bank, 'tooling/prettier.js', 'export default { semi: false };\n');
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

  it('exits 1 on an error, distinct from both other outcomes', () => {
    const { consumer } = setup();
    sync(consumer);
    merge(consumer, ['--allow-unrelated-histories']);
    pin(consumer, 'bank/nope');

    expect(check(consumer).status).toBe(1);
  });
});
