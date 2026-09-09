/**
 * `check-portable` as a command, against a repo with one violation of each rule.
 *
 * The rules have unit tests over values. What only a process shows is the part
 * that makes landing this early worth anything: it *reports* the backlog and
 * exits 0, so the count can be reviewed and the rules argued with before a
 * sweep is made in their name. The day that changes, the third case here fails
 * and says so.
 *
 * Offending references are built rather than written as literals — this file is
 * scanned by the real gate run too.
 */
import { afterAll, describe, expect, it } from 'vitest';

import {
  createRepoFixture,
  manifest,
  removeRepoFixtures,
  runCheck,
} from '../../repo-fixture';

afterAll(removeRepoFixtures);

const ADR_DIR = 'docs/adr';
const UI = 'packages/shared/ui';

const adr = (number: number, slug: string) =>
  `${String(number).padStart(4, '0')}-${slug}.md`;

const bareRef = (number: number) => `ADR ${String(number).padStart(4, '0')}`;
const issueRef = (number: number) => `#${number}`;

const body = (title: string) =>
  `# ${title}\n\n**Status:** accepted\n\nBecause of a trade-off worth recording.\n`;

const rootAdr = `${ADR_DIR}/${adr(1, 'a-root-decision')}`;
const uiAdr = `${UI}/${ADR_DIR}/${adr(1, 'a-ui-decision')}`;

/** A repo with two ADRs, an app, and nothing that offends any rule. */
const clean = (): Record<string, string> => ({
  'package.json': manifest({ name: 'fixture' }),
  [rootAdr]: body('A root decision'),
  [uiAdr]: body('A ui decision'),
  [`${UI}/package.json`]: manifest({ name: '@fixture/ui' }),
  [`${UI}/src/index.ts`]: `// See ../${ADR_DIR}/${adr(1, 'a-ui-decision')}.\nexport const x = 1;\n`,
  'apps/web/package.json': manifest({ name: '@fixture/web' }),
});

const check = (files: Record<string, string>, args: string[] = []) =>
  runCheck('check-portable', [
    createRepoFixture({ files, tracked: true }),
    ...args,
  ]);

describe('a repo with nothing to report', () => {
  it('exits zero and says what it read', () => {
    const { status, stdout } = check(clean());

    expect(status).toBe(0);
    expect(stdout).toContain('carry no reference that only resolves here');
    expect(stdout).not.toContain('non-portable');
  });
});

describe('a repo violating each rule once', () => {
  const offending = (): Record<string, string> => ({
    ...clean(),
    // 1. a number with no path, and 3. an issue reference.
    [`${UI}/src/index.ts`]: `// Rationale: ${bareRef(1)}.\n// Deferred: ${issueRef(126)}.\nexport const x = 1;\n`,
    // 2. an ADR path resolving outside the citing package.
    [`${UI}/CONTEXT.md`]: `See [it](../../../${rootAdr}).\n`,
    // 4. a root ADR naming an app.
    [rootAdr]: `${body('A root decision')}It applies to apps/web.\n`,
  });

  it('names all four, each with its file and line', () => {
    const { stderr } = check(offending());

    expect(stderr).toContain(`${UI}/src/index.ts:1`);
    expect(stderr).toContain(`${UI}/src/index.ts:2`);
    expect(stderr).toContain(`${UI}/CONTEXT.md:1`);
    expect(stderr).toContain(`${rootAdr}:6`);
  });

  it('names the rule each one broke', () => {
    const { stderr } = check(offending());

    expect(stderr).toContain('cites an ADR by number alone');
    expect(stderr).toContain('references issue');
    expect(stderr).toContain('a root ADR');
    expect(stderr).toContain('a root ADR names');
  });

  it('reports without failing, and prints the count', () => {
    const { status, stdout } = check(offending());

    expect(status).toBe(0);
    expect(stdout).toContain('4 non-portable references');
    expect(stdout).toContain('not failing lint yet');
  });

  it('leaves the distribution inventory alone — it is never distributed', () => {
    const { stdout } = check({
      ...clean(),
      'bank.paths.json': `{ "note": "${bareRef(1)}, ${issueRef(126)}" }\n`,
    });

    expect(stdout).toContain('carry no reference that only resolves here');
  });

  it('leaves an app alone — the bank never distributes one', () => {
    const { stdout } = check({
      ...clean(),
      'apps/web/src/index.ts': `// Rationale: ${bareRef(1)}, ${issueRef(126)}.\n`,
    });

    expect(stdout).toContain('carry no reference that only resolves here');
  });
});

describe('a backlog too long to read on every lint', () => {
  const many = 30;
  const backlog = (): Record<string, string> => ({
    ...clean(),
    [`${UI}/src/index.ts`]: Array.from(
      { length: many },
      (_, index) => `// Deferred: ${issueRef(100 + index)}.\n`,
    ).join(''),
  });

  it('lists the first few and says how many it held back', () => {
    const { stdout, stderr } = check(backlog());

    expect(stdout).toContain(`${many} non-portable references`);
    expect(stderr).toContain('Run `pnpm check:portable --all`');
    expect(stderr).toContain(issueRef(100));
    expect(stderr).not.toContain(issueRef(100 + many - 1));
  });

  it('prints every one of them under --all', () => {
    const { stderr } = check(backlog(), ['--all']);

    expect(stderr).toContain(issueRef(100 + many - 1));
    expect(stderr).not.toContain('Run `pnpm check:portable --all`');
  });
});

describe('the repo it lives in', () => {
  it('passes with no argument at all — the way the gate invokes it', () => {
    const { status, stdout } = runCheck('check-portable', []);

    expect(status).toBe(0);
    expect(stdout).toContain('check-portable:');
  });
});
