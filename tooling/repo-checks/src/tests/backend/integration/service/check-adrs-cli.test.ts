/**
 * `check-adrs` as a command: the exit code, the summary shape, and the two
 * things only a real repo shows — that it reads the git index rather than the
 * working directory, and that a root ADR and a package ADR sharing a number is
 * fine.
 *
 * That last case carries as much weight as any failure. A checker that flagged
 * it would force exactly the renumbering the per-directory rule exists to
 * avoid, and renumbering re-breaks every link.
 *
 * ADR filenames are built, never written as literals — see the unit tests.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import {
  createRepoFixture,
  removeRepoFixtures,
  runCheck,
} from '../../repo-fixture';

afterAll(removeRepoFixtures);

const ADR_DIR = 'docs/adr';
const alphaAdrDir = `packages/shared/alpha/${ADR_DIR}/`;

const adr = (number: number, slug: string) =>
  `${String(number).padStart(4, '0')}-${slug}.md`;

const body = (title: string, status = 'accepted') =>
  `# ${title}\n\n**Status:** ${status}\n\nBecause of a trade-off worth recording.\n`;

/** One root ADR, one package ADR, and the row that links the package. */
const baseline = (): Record<string, string> => ({
  'CONTEXT-MAP.md': `| \`packages/shared/alpha/\` | [ADRs](${alphaAdrDir}) |\n`,
  [`${ADR_DIR}/${adr(1, 'a-root-decision')}`]: body('A root decision'),
  [`${alphaAdrDir}${adr(1, 'an-alpha-decision')}`]: body('An alpha decision'),
});

const check = (files: Record<string, string>) =>
  runCheck('check-adrs', [createRepoFixture({ files, tracked: true })]);

describe('a clean repo', () => {
  it('exits zero and reports what it counted', () => {
    const { status, stdout } = check(baseline());

    expect(status).toBe(0);
    expect(stdout).toContain('check-adrs: 2 ADRs across 2 directories');
  });

  it('passes when a root ADR and a package ADR share a number', () => {
    expect(check(baseline()).status).toBe(0);
  });
});

describe('a repo that has drifted', () => {
  it('exits non-zero, names the problem and points at the rule', () => {
    const { status, stdout, stderr } = check({
      ...baseline(),
      [`${alphaAdrDir}${adr(1, 'another-alpha-decision')}`]: body(
        'Another alpha decision',
      ),
    });

    expect(status).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toContain('check-adrs found 1 problem');
    expect(stderr).toContain(alphaAdrDir);
    expect(stderr).toContain('docs/agents/domain.md');
  });

  it('warns on a gap without failing the run', () => {
    const { status, stderr } = check({
      ...baseline(),
      [`${ADR_DIR}/${adr(3, 'a-later-root-decision')}`]: body(
        'A later root decision',
      ),
    });

    expect(status).toBe(0);
    expect(stderr).toContain('warn:');
    expect(stderr).toContain('0002');
  });

  it('fails a dead citation anywhere in the repo, not only in an ADR', () => {
    const missing = adr(9, 'a-decision-that-moved');

    const { status, stderr } = check({
      ...baseline(),
      'scripts/thing.mjs': `// Rationale: ${ADR_DIR}/${missing}\nexport const x = 1;\n`,
    });

    expect(status).toBe(1);
    expect(stderr).toContain('scripts/thing.mjs');
  });

  it('fails a package owning ADRs with no CONTEXT-MAP.md row', () => {
    const { status, stderr } = check({
      ...baseline(),
      'CONTEXT-MAP.md': '# Context Map\n\nNo rows yet.\n',
    });

    expect(status).toBe(1);
    expect(stderr).toContain('packages/shared/alpha');
  });
});

describe('what it reads', () => {
  it('sees only tracked files, so an untracked working copy is invisible', () => {
    const root = createRepoFixture({ files: baseline(), tracked: true });
    const missing = adr(9, 'a-decision-that-moved');

    // The same dead citation the tracked case fails on, written after the
    // index was built — this is what keeps `node_modules` out of the scan.
    writeFileSync(
      join(root, 'untracked.md'),
      `See [the decision](${ADR_DIR}/${missing}).\n`,
    );

    expect(runCheck('check-adrs', [root]).status).toBe(0);
  });
});

describe('the repo it lives in', () => {
  it('passes with no argument at all — the way the gate invokes it', () => {
    const { status, stdout } = runCheck('check-adrs', []);

    expect(status).toBe(0);
    expect(stdout).toContain('check-adrs:');
  });
});
