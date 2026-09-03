/**
 * Verifies `scripts/check-adrs.mjs` — the gate that keeps ADR numbering,
 * status lines and citations honest ([domain.md](../../../../../docs/agents/domain.md)).
 *
 * Every case builds a throwaway repo holding only what the rule under test
 * needs, copies the real script into its `scripts/`, and runs it there: the
 * script derives its root from its own location, so a sandbox is a complete
 * repo as far as it is concerned. `git init` + `git add` is required rather than
 * incidental — the script enumerates content with `git ls-files`, which is what
 * keeps `node_modules` and build output out of the link scan.
 *
 * The cases that must *pass* carry as much weight as the failures. A number
 * reused across two directories is correct (the sequences are independent), and
 * a gap left by a deletion warns rather than fails — hard-failing either one
 * would force a renumber that re-breaks every citation.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
// src/tests/backend -> repo root is five levels up.
const repoRoot = resolve(here, '../../../../../');

const sandboxes: string[] = [];

afterEach(() => {
  for (const sandbox of sandboxes.splice(0)) {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

/** An ADR body with the status line the gate demands. */
function adr(title: string, status = 'accepted') {
  return `# ${title}\n\n**Status:** ${status}\n\nOne paragraph of reasoning.\n`;
}

/**
 * A repo holding `files` (path -> content), plus the real script and a context
 * map naming every package that owns ADRs. Returns the checker's exit code and
 * its combined output.
 */
function check(
  files: Record<string, string>,
  { mapRows = [] as string[] } = {},
) {
  const sandbox = mkdtempSync(join(tmpdir(), 'check-adrs-'));
  sandboxes.push(sandbox);

  const write = (path: string, content: string) => {
    mkdirSync(join(sandbox, dirname(path)), { recursive: true });
    writeFileSync(join(sandbox, path), content);
  };

  write(
    'CONTEXT-MAP.md',
    `# Context Map\n\n${mapRows.map((row) => `| \`${row}\` |\n`).join('')}`,
  );
  for (const [path, content] of Object.entries(files)) write(path, content);
  mkdirSync(join(sandbox, 'scripts'), { recursive: true });
  cpSync(
    join(repoRoot, 'scripts/check-adrs.mjs'),
    join(sandbox, 'scripts/check-adrs.mjs'),
  );

  execFileSync('git', ['init', '-q'], { cwd: sandbox });
  execFileSync('git', ['add', '-A'], { cwd: sandbox });

  const run = spawnSync('node', ['scripts/check-adrs.mjs'], {
    cwd: sandbox,
    encoding: 'utf8',
  });
  return { code: run.status, output: `${run.stdout}${run.stderr}` };
}

describe('numbering is per directory', () => {
  it('passes when the root and a package both start at 0001', () => {
    const { code, output } = check(
      {
        'docs/adr/0001-a-repo-wide-decision.md': adr('A repo-wide decision'),
        'packages/features/thing/docs/adr/0001-a-package-decision.md':
          adr('A package decision'),
      },
      { mapRows: ['packages/features/thing/'] },
    );

    expect(code, output).toBe(0);
    expect(output).toContain('2 ADRs across 2 directories');
  });

  it('fails naming both files when one directory reuses a number', () => {
    const { code, output } = check({
      'docs/adr/0001-first.md': adr('First'),
      'docs/adr/0001-second.md': adr('Second'),
    });

    expect(code).toBe(1);
    expect(output).toContain('two ADRs share the number 0001');
    expect(output).toContain('0001-first.md');
    expect(output).toContain('0001-second.md');
  });

  it('warns and passes on a gap left by a deleted ADR', () => {
    const { code, output } = check({
      'docs/adr/0001-first.md': adr('First'),
      'docs/adr/0003-third.md': adr('Third'),
    });

    expect(code, output).toBe(0);
    expect(output).toContain('sequence gap at 0002');
  });
});

describe('status lines', () => {
  it('fails an ADR with no status line under its title', () => {
    const { code, output } = check({
      'docs/adr/0001-first.md': '# First\n\nOne paragraph of reasoning.\n',
    });

    expect(code).toBe(1);
    expect(output).toContain('no status line under the title');
  });

  it('rejects "superseded by", pointing at delete-or-amend instead', () => {
    const { code, output } = check({
      'docs/adr/0001-first.md': adr('First', 'superseded by 0002-second.md'),
      'docs/adr/0002-second.md': adr('Second'),
    });

    expect(code).toBe(1);
    expect(output).toContain('A superseded ADR is deleted, not kept');
  });

  it('rejects a status value outside the vocabulary', () => {
    const { code, output } = check({
      'docs/adr/0001-first.md': adr('First', 'proposed'),
    });

    expect(code).toBe(1);
    expect(output).toContain('unreadable status');
  });

  it('accepts "amended by" naming a real ADR, and a trailing note', () => {
    const { code, output } = check({
      'docs/adr/0001-first.md': adr('First', 'amended by 0002-second.md'),
      'docs/adr/0002-second.md': adr('Second', 'accepted (ticket #1)'),
    });

    expect(code, output).toBe(0);
  });

  it('fails when "amended by" names a path that does not resolve', () => {
    const { code, output } = check({
      'docs/adr/0001-first.md': adr('First', 'amended by 0009-nowhere.md'),
    });

    expect(code).toBe(1);
    expect(output).toContain('0009-nowhere.md');
  });

  it('fails an ADR that keeps a second status in a "## Status" section', () => {
    const { code, output } = check({
      'docs/adr/0001-first.md': `${adr('First')}\n## Status\n\naccepted\n`,
    });

    expect(code).toBe(1);
    expect(output).toContain('an ADR carries exactly one status');
  });
});

describe('citations', () => {
  it('fails a dead markdown link, naming the file and the target', () => {
    const { code, output } = check({
      'docs/adr/0001-first.md': adr('First'),
      'CONTEXT.md': 'See [ADR 0009](docs/adr/0009-nowhere.md).\n',
    });

    expect(code).toBe(1);
    expect(output).toContain('CONTEXT.md');
    expect(output).toContain('docs/adr/0009-nowhere.md');
  });

  it('fails a dead path written in a source comment', () => {
    const { code, output } = check({
      'docs/adr/0001-first.md': adr('First'),
      'packages/features/thing/src/index.ts':
        '// See docs/adr/0009-nowhere.md.\nexport const x = 1;\n',
    });

    expect(code).toBe(1);
    expect(output).toContain('docs/adr/0009-nowhere.md');
  });

  it('accepts a citation by number alone, so a slug can be rewritten', () => {
    const { code, output } = check({
      'docs/adr/0001-first.md': adr('First'),
      'packages/features/thing/src/index.ts':
        '// See docs/adr/0001.\nexport const x = 1;\n',
    });

    expect(code, output).toBe(0);
  });

  it('resolves a generator template link from the root, past its ../ prefix', () => {
    const template = 'turbo/generators/templates/feature/README.md.hbs';
    const resolving = check({
      'docs/adr/0001-first.md': adr('First'),
      [template]: 'Doctrine: [ADR 0001](../../../docs/adr/0001-first.md).\n',
    });
    const dead = check({
      'docs/adr/0001-first.md': adr('First'),
      [template]: 'Doctrine: [ADR 0009](../../../docs/adr/0009-nowhere.md).\n',
    });

    expect(resolving.code, resolving.output).toBe(0);
    expect(dead.code).toBe(1);
    expect(dead.output).toContain('0009-nowhere.md');
  });

  it('ignores an illustrative path inside a fenced code block', () => {
    const { code, output } = check({
      'docs/adr/0001-first.md': adr('First'),
      'docs/agents/domain.md':
        '# Domain\n\n```\ndocs/adr/0001-slug.md\ndocs/adr/0002-slug.md\n```\n',
    });

    expect(code, output).toBe(0);
  });
});

describe('ownership', () => {
  it('fails a package that owns ADRs with no context-map row', () => {
    const { code, output } = check({
      'packages/features/thing/docs/adr/0001-a-package-decision.md':
        adr('A package decision'),
    });

    expect(code).toBe(1);
    expect(output).toContain('has no CONTEXT-MAP.md row');
  });

  it('fails a tooling package that owns an ADR directory at all', () => {
    const { code, output } = check(
      {
        'tooling/config/docs/adr/0001-a-tooling-decision.md':
          adr('A tooling decision'),
      },
      { mapRows: ['tooling/config/'] },
    );

    expect(code).toBe(1);
    expect(output).toContain('tooling/* owns no ADR directory');
  });

  it('accepts a package that owns ADRs and no glossary', () => {
    const { code, output } = check(
      {
        'packages/shared/widgets/docs/adr/0001-a-widget-decision.md':
          adr('A widget decision'),
      },
      { mapRows: ['packages/shared/widgets/'] },
    );

    expect(code, output).toBe(0);
  });
});
