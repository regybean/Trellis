/**
 * Rule 4, against the cases the other implementation of it is held to.
 *
 * The rule about what a distributed file may name exists twice. This half runs
 * inside `check-portable`; the other is `check-bank-tokens.mjs`, which runs
 * before `pnpm install` resolves anything and so imports nothing at all. Neither
 * package can import the other, so both carry the same patterns, the same span
 * arithmetic measured back from the closing brace, the same scoped-name dedupe,
 * the same symlink skip and the same derivations.
 *
 * Two copies of one rule drift silently: each reads as complete and correct on
 * its own, and the half that went quiet is invisible until something it should
 * have caught ships. So the cases are written down once, as data, and both
 * suites assert their own implementation against all of them.
 *
 * The corpus lives with the bank because the bank is the side that can reach
 * nothing — a sibling file is its only option — which leaves this side doing the
 * reaching. It is a read at a path rather than an import, deliberately: this
 * package has to keep working in a repo with no bank, and a dependency on one
 * would be exactly the coupling `portable.ts` refuses. Where the corpus is
 * absent the suite skips, naming what it wanted.
 *
 * The file is outside this package, so the task graph cannot see it from here.
 * The root `turbo.json` names it as a global dependency for that reason; without
 * it a case could be added, this suite stay cached, and the gate read green on a
 * rule these two halves no longer agreed about.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import type { RepoIo } from '../../../io';
import {
  appTokens,
  checkPortable,
  validateRootAdrApps,
  workspaceScopes,
} from '../../../portable';

// src/tests/backend/unit -> the repo root is six levels up.
const CORPUS = path.resolve(
  import.meta.dirname,
  '../../../../../../tooling/bank/src/tests/backend/portable-token-cases.json',
);

const present = existsSync(CORPUS);

const NEEDS_CORPUS =
  'skipped: needs the portable-token corpus the bank keeps, which is where the cases both implementations of this rule are held to live — this repo has no bank';

/** A describe that names the content it wanted when it skips. */
function describeShared(name: string, suite: () => void) {
  describe.skipIf(!present)(
    present ? name : `${name} — ${NEEDS_CORPUS}`,
    suite,
  );
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const record = (value: unknown, field: string): Record<string, unknown> => {
  if (!isRecord(value)) return {};
  const entry = value[field];
  return isRecord(entry) ? entry : {};
};

const text = (value: unknown, field: string): string => {
  if (!isRecord(value)) return '';
  const entry = value[field];
  return typeof entry === 'string' ? entry : '';
};

const strings = (value: unknown, field: string): string[] => {
  if (!isRecord(value)) return [];
  const entry = value[field];
  if (!Array.isArray(entry)) return [];
  return entry.filter((item): item is string => typeof item === 'string');
};

const records = (value: unknown, field: string): Record<string, unknown>[] => {
  if (!isRecord(value)) return [];
  const entry = value[field];
  if (!Array.isArray(entry)) return [];
  return entry.filter(isRecord);
};

/**
 * The corpus, or an empty one where there is none.
 *
 * `describe.skipIf` still runs the suite body to collect what it would have
 * run, so a bare read at the top of this file takes the whole file down with
 * ENOENT in a repo that has no bank — before a single test can be reported as
 * skipped. The guard has to be on the read.
 */
const corpus: unknown = present ? JSON.parse(readFileSync(CORPUS, 'utf8')) : {};

const identity = record(corpus, 'identity');
const manifests = record(identity, 'manifests');
const symlink = record(corpus, 'symlink');

interface LineCase {
  readonly name: string;
  readonly line: string;
  readonly names: readonly string[];
}

const cases: LineCase[] = records(corpus, 'lines').map((entry) => ({
  name: text(entry, 'case'),
  line: text(entry, 'line'),
  names: strings(entry, 'names').sort(),
}));

/** The manifest set the corpus derives its identity from, as a repo. */
function manifestRepo(extra: Record<string, string> = {}): RepoIo {
  const files: Record<string, string> = { ...extra };
  for (const [file, contents] of Object.entries(manifests)) {
    if (typeof contents === 'string') files[file] = contents;
  }

  return {
    tracked: () => Object.keys(files),
    read: (rel) => files[rel] ?? '',
    exists: (rel) => rel in files,
    isSymlink: (rel) => rel === text(symlink, 'alias'),
  };
}

const io = manifestRepo();
const apps = present ? appTokens(io.tracked(), io) : [];
const scopes = present ? workspaceScopes(io.tracked(), io) : new Set<string>();

/** The tokens a report named, whichever half wrote it. */
const namedIn = (errors: readonly string[]) =>
  errors.flatMap((error) => /names `([^`]+)`/.exec(error)?.[1] ?? []).sort();

/**
 * A root document: rule 4's scope, and where a case is read.
 *
 * Assembled rather than written out, like every other reference in this
 * package's suites. A literal ADR path here is a citation as far as
 * `check-adrs` is concerned, and it would resolve to no file.
 */
const DOC = `docs/adr/${String(1).padStart(4, '0')}-a-decision.md`;

describeShared('the identity the corpus derives', () => {
  it('reads the apps off the manifests, anchored to the app directory', () => {
    expect(apps).toEqual(strings(identity, 'apps'));
  });

  it('reads every scope the workspace publishes under, and only those', () => {
    expect([...scopes].sort()).toEqual(strings(identity, 'scopes'));
  });
});

describeShared('the cases both implementations of the rule are held to', () => {
  it('reads a corpus with cases in it, so the rule is not vacuous', () => {
    expect(cases.length).toBeGreaterThan(10);
    expect(cases.every((entry) => entry.name !== '' && entry.line !== '')).toBe(
      true,
    );
    expect(cases.some((entry) => entry.names.length > 0)).toBe(true);
    expect(cases.some((entry) => entry.names.length === 0)).toBe(true);
  });

  it.each(cases)('$name', ({ line, names }) => {
    const found = validateRootAdrApps(DOC, `${line}\n`, apps, scopes);

    expect(
      namedIn(found),
      `\`${line}\` was expected to name ${names.length === 0 ? 'nobody' : names.join(', ')}`,
    ).toEqual([...names]);
  });

  it('reads a symlink target once and the link never', () => {
    const file = text(symlink, 'file');
    const line = `${text(symlink, 'line')}\n`;
    const { violations } = checkPortable(
      manifestRepo({ [file]: line, [text(symlink, 'alias')]: line }),
    );

    expect(namedIn(violations.errors)).toEqual(
      strings(symlink, 'names').sort(),
    );
    expect(violations.errors[0]).toContain(file);
  });
});
