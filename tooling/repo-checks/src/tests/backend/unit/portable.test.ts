/**
 * The portability rules, rule by rule.
 *
 * Each is a function of a file's path and its text, so a case here is a string
 * and a verdict — no repo, no disk, and no subprocess. What the CLI test adds
 * on top is the two things only a process shows: that the backlog is reported
 * rather than enforced, and that the count is real.
 *
 * Every offending reference is *built* rather than written as a literal. This
 * file is itself scanned in the real gate run, and a literal fixture would read
 * there as exactly the violation it is a fixture for.
 */
import { describe, expect, it } from 'vitest';

import {
  owningPackage,
  validateAdrNumbers,
  validateAdrScope,
  validateIssueRefs,
  validateRootAdrApps,
} from '../../../portable';

const ADR_DIR = 'docs/adr';

/** `0001-a-decision.md`, assembled. */
const adr = (number: number, slug: string) =>
  `${String(number).padStart(4, '0')}-${slug}.md`;

/** `ADR 0001` — the bare citation the first rule rejects. */
const bareRef = (number: number, prefix = 'ADR ') =>
  `${prefix}${String(number).padStart(4, '0')}`;

/** `#<n>` — the bare issue reference the third rule rejects. */
const issueRef = (number: number) => `#${number}`;

/** Existence as a predicate over a set of repo-relative paths. */
const only = (...paths: string[]) => {
  const present = new Set(paths);
  return (rel: string) => present.has(rel);
};

describe('a citation carries the path', () => {
  const decision = `${ADR_DIR}/${adr(39, 'the-selection-is-the-contract')}`;

  it('rejects a number written on its own', () => {
    const found = validateAdrNumbers(
      'packages/shared/ui/src/index.ts',
      `// Rationale: ${bareRef(39)}.\n`,
    );

    expect(found).toHaveLength(1);
    expect(found[0]).toContain('packages/shared/ui/src/index.ts:1');
    expect(found[0]).toContain(bareRef(39));
  });

  it.each(['ADR ', 'ADR-', 'ADR #', 'ADRs ', 'adr '])(
    'rejects it however it is spelled: %s',
    (prefix) => {
      expect(
        validateAdrNumbers('a.md', `See ${bareRef(39, prefix)} for why.\n`),
      ).toHaveLength(1);
    },
  );

  it('accepts a number the same reference qualifies with a path', () => {
    expect(
      validateAdrNumbers('a.md', `See [${bareRef(39)}](${decision}).\n`),
    ).toEqual([]);
  });

  it('accepts a path pushed onto the next line by a wrapped comment', () => {
    expect(
      validateAdrNumbers(
        'a.ts',
        `// The selection is the contract (${bareRef(39)},\n// ${decision}).\n`,
      ),
    ).toEqual([]);
  });

  it('still reports the bare one when a paragraph cites two ADRs', () => {
    const other = `${ADR_DIR}/${adr(40, 'script-logic-lives-in-a-tooling-package')}`;
    const found = validateAdrNumbers(
      'a.md',
      `[${bareRef(40)}](${other}) applies, and so does ${bareRef(39)}.\n`,
    );

    expect(found).toHaveLength(1);
    expect(found[0]).toContain(bareRef(39));
  });

  it('reads a path as a path, not as a bare number', () => {
    expect(validateAdrNumbers('a.md', `See ${decision}.\n`)).toEqual([]);
  });

  it('reports the line the reference sits on', () => {
    const found = validateAdrNumbers('a.md', `one\ntwo\n${bareRef(39)}\n`);

    expect(found[0]).toContain('a.md:3');
  });
});

describe('the package a path belongs to', () => {
  const packages = ['packages/shared/ui', 'packages/shared/ui/fixtures'];

  it('is the root for a path inside none of them', () => {
    expect(owningPackage(`${ADR_DIR}/${adr(1, 'a')}`, packages)).toBe('');
  });

  it('is the longest match, so a nested package is its own', () => {
    expect(owningPackage('packages/shared/ui/fixtures/a.ts', packages)).toBe(
      'packages/shared/ui/fixtures',
    );
  });
});

describe('a citation resolves inside the citing package', () => {
  const ui = 'packages/shared/ui';
  const uiAdr = `${ui}/${ADR_DIR}/${adr(1, 'admin-widgets-to-ui')}`;
  const rootAdr = `${ADR_DIR}/${adr(11, 'remove-the-compositions-layer')}`;
  const packages = [ui, 'packages/shared/hooks'];

  it('accepts a package citing its own decision', () => {
    expect(
      validateAdrScope(
        `${ui}/src/index.ts`,
        `// See ./${ADR_DIR}/${adr(1, 'admin-widgets-to-ui')}.\n`,
        packages,
        only(uiAdr),
      ),
    ).toEqual([]);
  });

  it('rejects a package citing a root decision', () => {
    const found = validateAdrScope(
      `${ui}/src/index.ts`,
      `// See ../../../../${rootAdr}.\n`,
      packages,
      only(rootAdr),
    );

    expect(found).toHaveLength(1);
    expect(found[0]).toContain('a root ADR');
  });

  it("rejects a package citing another package's decision", () => {
    const found = validateAdrScope(
      'packages/shared/hooks/src/index.ts',
      `// See [it](../../ui/${ADR_DIR}/${adr(1, 'admin-widgets-to-ui')}).\n`,
      packages,
      only(uiAdr),
    );

    expect(found).toHaveLength(1);
    expect(found[0]).toContain(ui);
  });

  it('accepts one root ADR citing another — they travel together', () => {
    expect(
      validateAdrScope(
        `${ADR_DIR}/${adr(20, 'commit-tidies-gate-verifies')}`,
        `See [it](./${adr(11, 'remove-the-compositions-layer')}).\n`,
        packages,
        only(rootAdr),
      ),
    ).toEqual([]);
  });

  it('reads a bare path in a comment root-relatively too', () => {
    expect(
      validateAdrScope(
        `${ui}/src/index.ts`,
        `// See ${ui}/${ADR_DIR}/${adr(1, 'admin-widgets-to-ui')}.\n`,
        packages,
        only(uiAdr),
      ),
    ).toEqual([]);
  });

  it('stays quiet on a citation that resolves nowhere — check-adrs owns that', () => {
    expect(
      validateAdrScope(
        `${ui}/src/index.ts`,
        `// See ../../../${ADR_DIR}/${adr(99, 'a-decision-that-moved')}.\n`,
        packages,
        only(),
      ),
    ).toEqual([]);
  });

  it('ignores a link to an ADR directory, which names no decision', () => {
    expect(
      validateAdrScope(
        'CONTEXT-MAP.md',
        `| [ADRs](${ui}/${ADR_DIR}/) |\n`,
        packages,
        only(uiAdr),
      ),
    ).toEqual([]);
  });
});

describe('an issue number resolves in whichever tracker is read', () => {
  it('rejects a bare number', () => {
    const found = validateIssueRefs('a.ts', `// Deferred: ${issueRef(126)}.\n`);

    expect(found).toHaveLength(1);
    expect(found[0]).toContain(issueRef(126));
  });

  it.each(['#fff', '#123456', '# A heading', '#!/usr/bin/env bash'])(
    'is not fooled by %s',
    (text) => {
      expect(validateIssueRefs('a.md', `${text}\n`)).toEqual([]);
    },
  );

  it('leaves a qualified reference to another project alone', () => {
    const url = `https://github.com/vercel/next.js/issues/${62008}`;

    expect(validateIssueRefs('a.json', `// Workaround: ${url}\n`)).toEqual([]);
  });
});

describe('a root ADR names no app', () => {
  const apps = ['apps/', 'web', '@acme/web'];

  it.each(['apps/', 'web', '@acme/web'])('rejects %s', (token) => {
    const found = validateRootAdrApps(
      `${ADR_DIR}/${adr(10, 'a-decision')}`,
      `The decision applies to ${token} first.\n`,
      apps,
    );

    expect(found).toHaveLength(1);
    expect(found[0]).toContain(token);
  });

  it('rejects the apps directory with a name after it', () => {
    const found = validateRootAdrApps(
      `${ADR_DIR}/${adr(10, 'a-decision')}`,
      'It applies to apps/web first.\n',
      apps,
    );

    expect(found).toHaveLength(1);
    expect(found[0]).toContain('apps/');
  });

  it('reports a scoped name once, not twice for the name inside it', () => {
    expect(
      validateRootAdrApps(
        `${ADR_DIR}/${adr(10, 'a-decision')}`,
        'It applies to @acme/web.\n',
        apps,
      ),
    ).toHaveLength(1);
  });

  it('accepts a decision about the monorepo, which names none of them', () => {
    expect(
      validateRootAdrApps(
        `${ADR_DIR}/${adr(10, 'a-decision')}`,
        'Every app owns its own shell.\n',
        apps,
      ),
    ).toEqual([]);
  });

  it('matches a name whole, not as a substring of a longer word', () => {
    expect(
      validateRootAdrApps(
        `${ADR_DIR}/${adr(10, 'a-decision')}`,
        'The nextjs-canary spike is not an app.\n',
        apps,
      ),
    ).toEqual([]);
  });
});
