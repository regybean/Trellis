/**
 * ADR hygiene, rule by rule.
 *
 * These were reachable only as a subprocess against a real git repo, because
 * the checker ran `git ls-files` at module load — so even the numbering rules,
 * which are arithmetic over filenames, needed a repo on disk. Here the file list
 * is a list, and existence is a predicate.
 *
 * ADR filenames are *built*, never written as literals: this file is itself
 * scanned by the checker in the real gate run, and a literal fixture path would
 * read there as a citation of an ADR that does not exist.
 */
import { describe, expect, it } from 'vitest';

import {
  adrDirectories,
  carriesCitations,
  statusValue,
  validateCitations,
  validateMapRows,
  validateNumbering,
  validateStatus,
} from '../../../adrs';

const ADR_DIR = 'docs/adr';

/** `0001-a-decision.md`, assembled. */
const adr = (number: number, slug: string) =>
  `${String(number).padStart(4, '0')}-${slug}.md`;

/** A minimal valid ADR body: a title, then the status line under it. */
const body = (title: string, status = 'accepted') =>
  `# ${title}\n\n**Status:** ${status}\n\nBecause of a trade-off worth recording.\n`;

/** Existence as a predicate over a set of repo-relative paths. */
const only = (...paths: string[]) => {
  const present = new Set(paths);
  return (rel: string) => present.has(rel);
};

describe('the ADR directories', () => {
  it('groups files by directory and names each owner', () => {
    const dirs = adrDirectories([
      `${ADR_DIR}/${adr(1, 'a-root-decision')}`,
      `packages/shared/ui/${ADR_DIR}/${adr(1, 'a-ui-decision')}`,
      'packages/shared/ui/CONTEXT.md',
      'README.md',
    ]);

    expect(dirs).toEqual([
      {
        dir: ADR_DIR,
        owner: '',
        files: [adr(1, 'a-root-decision')],
      },
      {
        dir: `packages/shared/ui/${ADR_DIR}`,
        owner: 'packages/shared/ui',
        files: [adr(1, 'a-ui-decision')],
      },
    ]);
  });

  it('takes docs/adr/ as a path prefix, not a substring of a longer segment', () => {
    expect(adrDirectories(['packages/my-docs/adrs/notes.md'])).toEqual([]);
  });

  it('finds none in a repo that has none', () => {
    expect(adrDirectories(['README.md'])).toEqual([]);
  });
});

describe('numbering is per directory', () => {
  it('accepts a clean sequence', () => {
    const result = validateNumbering(ADR_DIR, [
      adr(1, 'the-first'),
      adr(2, 'the-second'),
      adr(3, 'the-third'),
    ]);

    expect(result).toEqual({ errors: [], warnings: [] });
  });

  it('fails two ADRs sharing a number, naming both', () => {
    const first = adr(1, 'a-decision');
    const second = adr(1, 'another-decision');

    const { errors } = validateNumbering(ADR_DIR, [first, second]);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(first);
    expect(errors[0]).toContain(second);
    expect(errors[0]).toContain('unique per directory');
  });

  it('warns on a gap, since a gap is the trace of a deletion', () => {
    const { errors, warnings } = validateNumbering(ADR_DIR, [
      adr(1, 'the-first'),
      adr(3, 'the-third'),
    ]);

    expect(errors).toEqual([]);
    expect(warnings[0]).toContain('0002');
    expect(warnings[0]).toContain("don't renumber");
  });

  it('reports every number a sequence skips', () => {
    const { warnings } = validateNumbering(ADR_DIR, [
      adr(1, 'the-first'),
      adr(4, 'the-fourth'),
    ]);

    expect(warnings[0]).toContain('0002, 0003');
  });

  it('fails a file that carries no number at all', () => {
    const { errors } = validateNumbering(ADR_DIR, ['notes.md']);

    expect(errors[0]).toContain('notes.md');
    expect(errors[0]).toContain('NNNN-kebab-slug.md');
  });

  it('says nothing about a directory holding a single ADR at 0001', () => {
    expect(validateNumbering(ADR_DIR, [adr(1, 'the-only-one')])).toEqual({
      errors: [],
      warnings: [],
    });
  });
});

describe('the status vocabulary', () => {
  const path = `${ADR_DIR}/${adr(3, 'a-decision')}`;
  const resolves = only(`${ADR_DIR}/${adr(1, 'the-amending-one')}`);
  const status = (text: string) =>
    validateStatus(path, text, (amending) =>
      resolves(`${ADR_DIR}/${amending}`),
    );

  it('accepts `accepted`', () => {
    expect(status(body('A decision'))).toEqual([]);
  });

  it('accepts a human note after the value', () => {
    expect(
      status(body('A decision', 'accepted — planning output, not yet built')),
    ).toEqual([]);
    expect(status(body('A decision', 'accepted (partially built)'))).toEqual(
      [],
    );
  });

  it('fails an ADR with no status line, saying where it goes', () => {
    const [error] = status('# A decision\n\nStraight into the prose.\n');

    expect(error).toContain(path);
    expect(error).toContain('**Status:**');
  });

  it('rejects `superseded by`, and says to delete or amend in place', () => {
    const [error] = status(
      body('A decision', `superseded by ${adr(1, 'the-amending-one')}`),
    );

    expect(error).toContain('superseded by');
    expect(error).toContain('deleted');
    expect(error).toContain('amended by');
  });

  it('accepts `amended by` when the path resolves', () => {
    expect(
      status(body('A decision', `amended by ${adr(1, 'the-amending-one')}`)),
    ).toEqual([]);
  });

  it('fails `amended by` when the path resolves to nothing', () => {
    const [error] = status(
      body('A decision', `amended by ${adr(9, 'a-decision-that-moved')}`),
    );

    expect(error).toContain('amending ADR');
    expect(error).toContain(ADR_DIR);
  });

  it('rejects a value outside the vocabulary entirely', () => {
    const [error] = status(body('A decision', 'draft'));

    expect(error).toContain('not in the vocabulary');
  });

  it('reads the machine-readable half of a status and nothing more', () => {
    expect(statusValue('accepted — but see the note below')).toBe('accepted');
    expect(statusValue('Accepted (mostly).')).toBe('accepted');
  });
});

describe('every ADR citation resolves', () => {
  const target = adr(1, 'a-root-decision');
  const exists = only(`${ADR_DIR}/${target}`, `${ADR_DIR}/`);

  it('passes a markdown link that resolves from the citing file', () => {
    expect(
      validateCitations(
        'docs/some-guide.md',
        `See [the decision](adr/${target}).\n`,
        exists,
      ),
    ).toEqual([]);
  });

  it('fails a dead link, naming the citing file and the target', () => {
    const missing = adr(9, 'a-decision-that-moved');

    const [error] = validateCitations(
      'docs/some-guide.md',
      `See [the decision](adr/${missing}).\n`,
      exists,
    );

    expect(error).toContain('docs/some-guide.md');
    expect(error).toContain(missing);
    expect(error).toContain('resolves to no file');
  });

  it('fails a dead ADR path in a source comment, not just a markdown link', () => {
    const missing = adr(9, 'a-decision-that-moved');

    const [error] = validateCitations(
      'tooling/repo-checks/src/thing.ts',
      `// Rationale: ${ADR_DIR}/${missing}\n`,
      exists,
    );

    expect(error).toContain('reference to');
  });

  it('accepts a bare path read from the repo root, as prose cites it', () => {
    expect(
      validateCitations(
        'tooling/repo-checks/src/thing.ts',
        `// Rationale: ${ADR_DIR}/${target}\n`,
        exists,
      ),
    ).toEqual([]);
  });

  it('judges a markdown link by its own file only, never the root', () => {
    // The same path a comment may cite either way round is dead in a link.
    const [error] = validateCitations(
      'docs/agents/some-guide.md',
      `See [the decision](${ADR_DIR}/${target}).\n`,
      exists,
    );

    expect(error).toContain('link to');
  });

  it('judges a template by where it renders, not where it lives', () => {
    // Four levels up escapes the repo from where the template *sits*; it is
    // correct for where the generator writes it.
    expect(
      validateCitations(
        'turbo/generators/templates/CONTEXT.md.hbs',
        `See [the decision](../../../../${ADR_DIR}/${target}).\n`,
        exists,
      ),
    ).toEqual([]);
  });

  it('reports a repeated dead citation once', () => {
    const missing = adr(9, 'a-decision-that-moved');
    const line = `See [it](${ADR_DIR}/${missing}).`;

    expect(
      validateCitations('docs/guide.md', `${line}\n${line}\n`, exists),
    ).toHaveLength(1);
  });

  it('ignores a link that is not an ADR, and an external URL', () => {
    expect(
      validateCitations(
        'docs/guide.md',
        'See [testing](./TESTING.md) and [the spec](https://example.test/adr/0001-x.md).\n',
        exists,
      ),
    ).toEqual([]);
  });

  it('accepts a link to an ADR directory, not only a file', () => {
    expect(
      validateCitations('README.md', `See [the ADRs](${ADR_DIR}/).\n`, exists),
    ).toEqual([]);
  });

  it('reads citations out of text files and leaves the rest alone', () => {
    expect(carriesCitations('docs/guide.md')).toBe(true);
    expect(carriesCitations('src/thing.ts')).toBe(true);
    expect(carriesCitations('turbo/generators/templates/x.hbs')).toBe(true);
    expect(carriesCitations('pnpm-lock.yaml')).toBe(true);
    expect(carriesCitations('public/logo.png')).toBe(false);
  });
});

describe('a package owning ADRs is on the map', () => {
  const directories = [
    { dir: ADR_DIR, owner: '', files: [adr(1, 'a-root-decision')] },
    {
      dir: `packages/shared/ui/${ADR_DIR}`,
      owner: 'packages/shared/ui',
      files: [adr(1, 'a-ui-decision')],
    },
  ];

  it('passes when the map links the directory', () => {
    expect(
      validateMapRows(
        directories,
        `| \`packages/shared/ui/\` | [ADRs](packages/shared/ui/${ADR_DIR}/) |\n`,
      ),
    ).toEqual([]);
  });

  it('fails when the package has no row, naming the package', () => {
    const [error] = validateMapRows(directories, '# Context Map\n\nNo rows.\n');

    expect(error).toContain('packages/shared/ui');
    expect(error).toContain('CONTEXT-MAP.md');
  });

  it('asks nothing of the root directory — it is the map itself', () => {
    expect(
      validateMapRows(directories.slice(0, 1), '# Context Map\n\nNo rows.\n'),
    ).toEqual([]);
  });
});
