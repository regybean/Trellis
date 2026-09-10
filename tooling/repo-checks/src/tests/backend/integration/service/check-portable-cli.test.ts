/**
 * `check-portable` as a command, against a repo with one violation of each rule.
 *
 * The rules have unit tests over values. What only a process shows is what the
 * gate does with them: every violation reported, the exit code non-zero, and
 * the exempt paths silent.
 *
 * Offending references are built rather than written as literals — this file is
 * scanned by the real gate run too.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { NOT_DISTRIBUTED, PORTABLE_HELP } from '../../../../portable';
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

  it('fails, and says how many it found', () => {
    const { status, stderr } = check(offending());

    expect(status).toBe(1);
    expect(stderr).toContain('check-portable found 4 problems');
    expect(stderr).toContain(PORTABLE_HELP);
  });

  // Driven off the constant rather than a list here, so adding a file to the
  // exemption is the same edit as claiming a test for it.
  it.each([...NOT_DISTRIBUTED])(
    'leaves %s alone — its subject is this repo, so it is never distributed',
    (path) => {
      const { stdout } = check({
        ...clean(),
        [path]: `A note about ${bareRef(1)} and ${issueRef(126)}.\n`,
      });

      expect(stdout).toContain('carry no reference that only resolves here');
    },
  );

  it('leaves an app alone — the bank never distributes one', () => {
    const { stdout } = check({
      ...clean(),
      'apps/web/src/index.ts': `// Rationale: ${bareRef(1)}, ${issueRef(126)}.\n`,
    });

    expect(stdout).toContain('carry no reference that only resolves here');
  });
});

describe('a report too long for one screen', () => {
  const many = 30;

  it('prints every violation — a truncated gate hides the fix list', () => {
    const { stderr } = check({
      ...clean(),
      [`${UI}/src/index.ts`]: Array.from(
        { length: many },
        (_, index) => `// Deferred: ${issueRef(100 + index)}.\n`,
      ).join(''),
    });

    expect(stderr).toContain(issueRef(100));
    expect(stderr).toContain(issueRef(100 + many - 1));
  });
});

describe('the repo it lives in', () => {
  it('passes with no argument at all — the way the gate invokes it', () => {
    const { status, stdout } = runCheck('check-portable', []);

    expect(status).toBe(0);
    expect(stdout).toContain('carry no reference that only resolves here');
  });
});
