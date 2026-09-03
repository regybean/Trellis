/**
 * Verifies `scripts/check-adrs.mjs` against throwaway repos in a temp dir.
 *
 * Each case is a whole repo, because every rule is about a *relationship*
 * between files — two ADRs in one directory, a citation and its target, a
 * package and its `CONTEXT-MAP.md` row. Nothing is stubbed: the checker reads
 * `git ls-files` and the filesystem, so the fixtures are real git repos with
 * real files, the way `bank-sandbox` does it.
 *
 * The two **passing** cases carry as much weight as the failures. A checker
 * that fails on a root and a package sharing a number, or on the gap a deletion
 * leaves behind, would force exactly the renumbering the per-directory rule
 * exists to avoid — and renumbering re-breaks every link.
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
const CHECKER = join(repoRoot, 'scripts/check-adrs.mjs');

/**
 * ADR filenames are *built*, never written as literals. This file is itself
 * scanned by the checker in the real gate run, and a literal fixture path would
 * read there as a citation of an ADR that does not exist.
 */
const adr = (number: number, slug: string) =>
  `${String(number).padStart(4, '0')}-${slug}.md`;

/** A minimal valid ADR body: a title, then the status line under it. */
const body = (title: string, status = 'accepted') =>
  `# ${title}\n\n**Status:** ${status}\n\nBecause of a trade-off worth recording.\n`;

const sandboxes: string[] = [];

afterEach(() => {
  for (const dir of sandboxes.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/** A throwaway repo holding exactly `files`, staged so `git ls-files` sees it. */
function sandbox(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'check-adrs-'));
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

function check(dir: string) {
  const result = spawnSync('node', [CHECKER, dir], { encoding: 'utf8' });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    output: result.stdout + result.stderr,
  };
}

/** The shape every case starts from: one root ADR, one package ADR, one row. */
function baseline(): Record<string, string> {
  return {
    'CONTEXT-MAP.md': `| \`packages/alpha/\` | [ADRs](packages/alpha/docs/adr/) |\n`,
    [`docs/adr/${adr(1, 'a-root-decision')}`]: body('A root decision'),
    [`packages/alpha/docs/adr/${adr(1, 'an-alpha-decision')}`]:
      body('An alpha decision'),
  };
}

describe('numbering is per directory', () => {
  it('fails on two ADRs sharing a number in one directory, naming both', () => {
    const first = adr(1, 'an-alpha-decision');
    const second = adr(1, 'another-alpha-decision');
    const dir = sandbox({
      ...baseline(),
      [`packages/alpha/docs/adr/${second}`]: body('Another alpha decision'),
    });

    const { status, output } = check(dir);

    expect(status).toBe(1);
    expect(output).toContain(first);
    expect(output).toContain(second);
    expect(output).toContain('packages/alpha/docs/adr/');
  });

  it('passes when a root ADR and a package ADR share a number', () => {
    const { status, stdout } = check(sandbox(baseline()));

    expect(status).toBe(0);
    expect(stdout).toContain('check-adrs:');
  });

  it('warns but passes on a gap, since a gap is the trace of a deletion', () => {
    const dir = sandbox({
      ...baseline(),
      [`docs/adr/${adr(3, 'a-later-root-decision')}`]: body(
        'A later root decision',
      ),
    });

    const { status, output } = check(dir);

    expect(status).toBe(0);
    expect(output).toContain('warn:');
    expect(output).toContain('0002');
  });
});

describe('every ADR citation resolves', () => {
  it('fails on a dead link, naming the citing file and the target', () => {
    const missing = adr(9, 'a-decision-that-moved');
    const dir = sandbox({
      ...baseline(),
      'docs/some-guide.md': `See [the decision](adr/${missing}).\n`,
    });

    const { status, output } = check(dir);

    expect(status).toBe(1);
    expect(output).toContain('docs/some-guide.md');
    expect(output).toContain(missing);
  });

  it('fails on a dead ADR path in a source comment, not just a markdown link', () => {
    const missing = adr(9, 'a-decision-that-moved');
    const dir = sandbox({
      ...baseline(),
      'scripts/thing.mjs': `// Rationale: docs/adr/${missing}\nexport const x = 1;\n`,
    });

    const { status, output } = check(dir);

    expect(status).toBe(1);
    expect(output).toContain('scripts/thing.mjs');
  });

  it('passes when a package ADR cites a root ADR by relative path', () => {
    const target = adr(1, 'a-root-decision');
    const dir = sandbox({
      ...baseline(),
      [`packages/alpha/docs/adr/${adr(2, 'a-second-alpha-decision')}`]: `${body('A second alpha decision')}\nSee [the root rule](../../../../docs/adr/${target}).\n`,
    });

    expect(check(dir).status).toBe(0);
  });
});

describe('the status vocabulary', () => {
  it('fails when an ADR carries no status line', () => {
    const file = `docs/adr/${adr(3, 'an-unstamped-decision')}`;
    const dir = sandbox({
      ...baseline(),
      [file]: '# An unstamped decision\n\nStraight into the prose.\n',
    });

    const { status, output } = check(dir);

    expect(status).toBe(1);
    expect(output).toContain(file);
    expect(output).toContain('**Status:**');
  });

  it('rejects `superseded by`, and says to delete or amend in place', () => {
    const dir = sandbox({
      ...baseline(),
      [`docs/adr/${adr(3, 'an-overtaken-decision')}`]: body(
        'An overtaken decision',
        `superseded by ${adr(1, 'a-root-decision')}`,
      ),
    });

    const { status, output } = check(dir);

    expect(status).toBe(1);
    expect(output).toContain('superseded by');
    expect(output).toContain('deleted');
    expect(output).toContain('amended by');
  });

  it('fails when an `amended by` path resolves to nothing', () => {
    const dir = sandbox({
      ...baseline(),
      [`docs/adr/${adr(3, 'an-amended-decision')}`]: body(
        'An amended decision',
        `amended by ${adr(9, 'a-decision-that-moved')}`,
      ),
    });

    const { status, output } = check(dir);

    expect(status).toBe(1);
    expect(output).toContain('amending ADR');
  });

  it('passes on `amended by` when the path resolves', () => {
    const dir = sandbox({
      ...baseline(),
      [`docs/adr/${adr(3, 'an-amended-decision')}`]: body(
        'An amended decision',
        `amended by ${adr(1, 'a-root-decision')}`,
      ),
    });

    expect(check(dir).status).toBe(0);
  });

  it('accepts a human note after the value', () => {
    const dir = sandbox({
      ...baseline(),
      [`docs/adr/${adr(3, 'a-noted-decision')}`]: body(
        'A noted decision',
        'accepted — planning output, not yet built',
      ),
    });

    expect(check(dir).status).toBe(0);
  });
});

describe('a package owning ADRs is on the map', () => {
  it('fails when the package has no CONTEXT-MAP.md row', () => {
    const files = baseline();
    files['CONTEXT-MAP.md'] = '# Context Map\n\nNo rows yet.\n';

    const { status, output } = check(sandbox(files));

    expect(status).toBe(1);
    expect(output).toContain('packages/alpha');
    expect(output).toContain('CONTEXT-MAP.md');
  });

  it('needs only the row, not a CONTEXT.md — an ADR directory alone is enough', () => {
    expect(check(sandbox(baseline())).status).toBe(0);
  });
});
