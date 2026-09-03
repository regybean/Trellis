/**
 * Verifies `scripts/bank-contribute.mjs` — the back-flow half of the bank —
 * against real git repositories, using the sandbox in `./bank-sandbox`.
 *
 * Back-flow is the constrained direction: it takes code out of a repo that may
 * be private and puts it in one that is public. So the assertions that matter
 * most here are the refusals, and every one of them checks the bank afterwards
 * to prove nothing was pushed. Nothing is mocked; the bank is a real repo the
 * script really clones and really pushes to.
 *
 * The two cases that reach the scanner need gitleaks on `PATH`. It is a hard
 * requirement of the script rather than a nice-to-have, so those cases skip
 * rather than pretend when it is missing (CI installs it).
 */

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  cleanupSandboxes,
  commit,
  git,
  numberedLines,
  repoRoot,
  runScript,
  setup,
  syncAndMerge,
  write,
} from './bank-sandbox';

afterEach(cleanupSandboxes);

const hasGitleaks =
  spawnSync('gitleaks', ['version'], { stdio: 'ignore' }).status === 0;

function contribute(consumer: string, args: string[], input = '') {
  return runScript(consumer, 'scripts/bank-contribute.mjs', args, input);
}

/** Every branch in the bank — the "nothing was pushed" assertion. */
function branches(bank: string) {
  return git(bank, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/'])
    .split('\n')
    .filter(Boolean)
    .sort();
}

/** Edits a vendored file so the consumer has something to contribute. */
function divergeLocally(consumer: string, last = 'consumer fixed the tail') {
  write(consumer, 'tooling/eslint/index.js', numberedLines('bank first', last));
  commit(consumer, 'consumer: fix the tail');
}

describe('bank:contribute refuses before anything leaves the repo', () => {
  it('refuses every path while contributable is empty, and says a human must add it', () => {
    const { bank, consumer } = setup();
    syncAndMerge(consumer);
    divergeLocally(consumer);

    const { status, stderr } = contribute(consumer, [
      'tooling/eslint/index.js',
    ]);

    expect(status).toBe(1);
    expect(stderr).toContain('"contributable"');
    expect(stderr).toContain('is empty');
    expect(stderr).toContain('Add the path');
    // The judgement the allowlist exists to force.
    expect(stderr).toContain('Layer is not the test');
    expect(branches(bank)).toEqual(['main']);
  });

  it('refuses a path outside the allowlist, naming it and what is allowed', () => {
    const { bank, consumer } = setup({ contributable: ['tooling'] });
    syncAndMerge(consumer);
    write(consumer, 'turbo.json', '{ "tasks": { "lint": {} } }\n');
    commit(consumer, 'consumer: add a lint task');

    const { status, stderr } = contribute(consumer, ['turbo.json']);

    expect(status).toBe(1);
    expect(stderr).toContain('not in the "contributable" allowlist');
    expect(stderr).toContain('turbo.json');
    expect(stderr).toContain('Allowed today: tooling');
    expect(branches(bank)).toEqual(['main']);
  });

  it('refuses uncommitted changes rather than publishing the working tree', () => {
    const { bank, consumer } = setup({ contributable: ['tooling'] });
    syncAndMerge(consumer);
    write(
      consumer,
      'tooling/eslint/index.js',
      numberedLines('bank first', 'unsaved'),
    );

    const { status, stderr } = contribute(consumer, [
      'tooling/eslint/index.js',
    ]);

    expect(status).toBe(1);
    expect(stderr).toContain('uncommitted changes');
    expect(branches(bank)).toEqual(['main']);
  });

  it('refuses when the repo has never synced, so there is no base to diff against', () => {
    const { bank, consumer } = setup({ contributable: ['tooling'] });

    const { status, stderr } = contribute(consumer, [
      'tooling/eslint/index.js',
    ]);

    expect(status).toBe(1);
    expect(stderr).toContain('vendor/trellis does not exist');
    expect(branches(bank)).toEqual(['main']);
  });

  it('rejects an option rather than treating it as a path', () => {
    const { consumer } = setup({ contributable: ['tooling'] });

    const { status, stderr } = contribute(consumer, ['--yes', 'tooling']);

    expect(status).toBe(1);
    expect(stderr).toContain('unknown option --yes');
    expect(stderr).toContain('There is no flag to skip the confirmation');
  });
});

describe('bank:contribute with nothing to send', () => {
  it('says there is nothing to contribute and exits 0', () => {
    const { bank, consumer } = setup({ contributable: ['tooling'] });
    syncAndMerge(consumer);

    const { status, stdout } = contribute(consumer, ['tooling']);

    expect(status).toBe(0);
    expect(stdout).toContain('Nothing to contribute');
    expect(branches(bank)).toEqual(['main']);
  });
});

describe('bank:contribute opens the PR only after a human confirms', () => {
  it.skipIf(!hasGitleaks)(
    'prints the whole diff and aborts when the confirmation is not typed',
    () => {
      const { bank, consumer } = setup({ contributable: ['tooling'] });
      syncAndMerge(consumer);
      divergeLocally(consumer);

      const { status, stdout, stderr } = contribute(
        consumer,
        ['tooling/eslint/index.js'],
        'no\n',
      );

      // The human saw the diff before being asked.
      expect(stdout).toContain('--- a/tooling/eslint/index.js');
      expect(stdout).toContain('+consumer fixed the tail');
      expect(stdout).toContain('-bank last');
      expect(stdout).toContain('Type "contribute" to open the PR');

      expect(status).toBe(1);
      expect(stderr).toContain('aborted');
      expect(branches(bank)).toEqual(['main']);
    },
  );

  it.skipIf(!hasGitleaks)(
    'pushes a branch based on the bank commit this consumer merged',
    () => {
      const { bank, consumer } = setup({ contributable: ['tooling'] });
      syncAndMerge(consumer);
      divergeLocally(consumer);
      const bankTip = git(bank, ['rev-parse', 'main']);

      const { status, stdout } = contribute(
        consumer,
        ['tooling/eslint/index.js'],
        'contribute\n',
      );

      expect(status).toBe(0);
      const contributed = branches(bank).filter((name) => name !== 'main');
      expect(contributed).toHaveLength(1);
      const [pushed = ''] = contributed;
      expect(pushed).toContain('contribute/');
      expect(stdout).toContain(`Pushed ${pushed}`);

      // Cut from the commit the consumer merged, so the patch applies to the
      // bank by construction and the PR shows only the consumer's change.
      expect(git(bank, ['rev-parse', `${pushed}^`])).toBe(bankTip);
      expect(
        git(bank, ['show', `${pushed}:tooling/eslint/index.js`]),
      ).toContain('consumer fixed the tail');
      // Only the contributed path moved — nothing else rode along.
      expect(git(bank, ['diff', '--name-only', bankTip, pushed])).toBe(
        'tooling/eslint/index.js',
      );
    },
  );

  it.skipIf(!hasGitleaks)(
    'aborts and opens nothing when gitleaks flags the diff',
    () => {
      const { bank, consumer } = setup({ contributable: ['tooling'] });
      syncAndMerge(consumer);
      // Split so the literal never appears in this repo's own source, where the
      // gate's own gitleaks pass would flag it.
      const key = `AKIA${'ZZ4RVLXNQ2X7YAB6'}`;
      write(
        consumer,
        'tooling/eslint/index.js',
        numberedLines('bank first', `export const accessKeyId = "${key}";`),
      );
      commit(consumer, 'consumer: wire up the uploader');

      const { status, stderr } = contribute(
        consumer,
        ['tooling/eslint/index.js'],
        'contribute\n',
      );

      expect(status).toBe(1);
      expect(stderr).toContain('gitleaks flagged the diff');
      expect(branches(bank)).toEqual(['main']);
    },
  );
});

describe('nothing invokes bank:contribute automatically', () => {
  /**
   * Every real file under a repo directory, recursively. Symlinks are skipped
   * rather than followed — a worktree carries a few, and a dangling one is not
   * a thing that can invoke anything.
   */
  function walk(dir: string): string[] {
    return readdirSync(join(repoRoot, dir), { withFileTypes: true }).flatMap(
      (entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return walk(path);
        return entry.isFile() ? [path] : [];
      },
    );
  }

  /**
   * A command line that runs it, rather than a mention of it. The sibling bank
   * scripts name it in their comments and should keep doing so — describing the
   * command is not running it, which is also why docs are not searched.
   */
  const invocation =
    /(?:node|pnpm|npm|yarn|bun)\s+(?:run\s+|exec\s+)?[^\s'"]*bank[:-]contribute/;

  it('is invoked by no workflow, hook or other script in this repo', () => {
    const automation = [
      ...walk('.github'),
      'lefthook.yml',
      ...walk('scripts').filter(
        (path) => relative('scripts', path) !== 'bank-contribute.mjs',
      ),
    ];

    const invoking = automation.filter((path) =>
      invocation.test(readFileSync(join(repoRoot, path), 'utf8')),
    );

    expect(invoking).toEqual([]);
  });

  it('is defined as exactly one package script and used by no other', () => {
    const { scripts } = JSON.parse(
      readFileSync(join(repoRoot, 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };

    const referencing = Object.entries(scripts)
      .filter(([, command]) => invocation.test(command))
      .map(([name]) => name);

    expect(referencing).toEqual(['bank:contribute']);
  });
});
