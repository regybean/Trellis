/**
 * Portability: a distributed file carries no reference that only resolves here.
 *
 * Everything in `packages/` and `tooling/` is content another repo can take, so
 * a reference written for this checkout arrives there pointing at nothing — or,
 * worse, at the wrong document once the two repos' numbering diverges. That is
 * already a live defect in this repo, not only in a consumer: a bare `ADR 0001`
 * in a package that owns an ADR 0001 has nothing in the text saying which of
 * the two it means.
 *
 * Four rules, each structural and none of them naming this repo, so they ship
 * with the checker and keep a consumer's own content clean too:
 *
 *   1. **No bare ADR number.** A citation carries the path, so the slug names
 *      the decision and the reference survives renumbering.
 *   2. **No ADR citation resolving outside the citing package.** A package may
 *      cite its own ADRs; nothing else's. A file outside every package may cite
 *      the root's, because root ADRs travel with the root.
 *   3. **No bare issue number.** `#126` resolves in whichever tracker the
 *      reader happens to be looking at, which is the problem.
 *   4. **No root ADR naming an app.** Apps are consumer identity, so a decision
 *      that has to name one is an app-layer decision filed in the wrong place.
 *
 * `apps/` is skipped entirely. The bank never distributes an app, so an app's
 * references are free to name whatever they like — here and in a consumer,
 * where `apps/` holds their own code and none of ours.
 *
 * Dead links are not this checker's business: `check-adrs` already reports a
 * citation that resolves to no file, and rule 2 stays quiet on one rather than
 * reporting the same line twice under two names.
 */
import { posix } from 'node:path';

import type { Violations } from '@acme/workspace-graph';
import { collectViolations } from '@acme/workspace-graph';

import type { RepoIo } from './io';
import { adrCitations, carriesCitations } from './adrs';

/** Where the rules are written down, printed under a failure. */
export const PORTABLE_HELP =
  'A distributed file cites ADRs by path, only its own package’s, and names no issue number.';

/** The root ADR directory — the one a distributed file may never cite. */
export const ROOT_ADR_DIR = 'docs/adr/';

/** Consumer identity, in this repo and in every consumer. */
const APPS_DIR = 'apps/';

/** The 1-based line an offset falls on, for a report a reader can jump to. */
function lineAt(text: string, index: number): number {
  let line = 1;
  for (let at = text.indexOf('\n'); at !== -1 && at < index; ) {
    line += 1;
    at = text.indexOf('\n', at + 1);
  }
  return line;
}

/** `path:line`, the prefix every violation below is reported under. */
const site = (file: string, text: string, index: number) =>
  `${file}:${lineAt(text, index)}`;

/** `ADR 0001`, `ADRs 0001`, `ADR-0001`, `ADR #0001` — a number with no path. */
const BARE_ADR_NUMBER = /\bADRs?[ \t\n-]*#?(\d{4})\b/gi;

/**
 * How far either side of a number the path that qualifies it may sit.
 *
 * A markdown citation writes both together — `[ADR 0039](../docs/adr/0039-…)` —
 * but a wrapped comment can push the target onto the next line, and a long
 * relative prefix eats the rest of it. The window is per *number*: it looks for
 * a path naming the same four digits, so a paragraph citing several ADRs still
 * reports the one that is bare.
 */
const PATH_WINDOW = 240;

/** Rule 1: a citation carries the path, never the number alone. */
export function validateAdrNumbers(file: string, text: string): string[] {
  const errors: string[] = [];

  for (const match of text.matchAll(BARE_ADR_NUMBER)) {
    const number = match[1] ?? '';
    const window = text.slice(
      Math.max(0, match.index - PATH_WINDOW),
      match.index + PATH_WINDOW,
    );
    if (window.includes(`docs/adr/${number}-`)) continue;

    errors.push(
      `${site(file, text, match.index)}: \`${match[0].trim()}\` cites an ADR by number alone. ` +
        `Write the path — \`docs/adr/${number}-<slug>.md\` — so the citation says which ` +
        `directory's ${number} it means and survives a renumber.`,
    );
  }

  return errors;
}

/** An ADR *file* path. A link to an ADR directory names no decision. */
const ADR_FILE = /(?:^|\/)docs\/adr\/\d{4}-[\w.-]+\.md$/;

/**
 * The workspace package a repo-relative path belongs to, or `''` for the root.
 *
 * Longest match wins, so a package nested inside another is read as its own.
 */
export function owningPackage(
  path: string,
  packages: readonly string[],
): string {
  let owner = '';
  for (const dir of packages) {
    if (dir.length <= owner.length) continue;
    if (path === dir || path.startsWith(`${dir}/`)) owner = dir;
  }
  return owner;
}

/**
 * Rule 2: an ADR citation resolves inside the citing package.
 *
 * @param packages Every workspace package directory, repo-relative.
 * @param exists Whether a repo-relative path exists. Injected, so a citation
 * and its target are a pair of values rather than a repo on disk.
 */
export function validateAdrScope(
  file: string,
  text: string,
  packages: readonly string[],
  exists: (rel: string) => boolean,
): string[] {
  const from = posix.dirname(file);
  const owner = owningPackage(file, packages);
  const errors: string[] = [];
  const reported = new Set<string>();

  for (const { path, index, bare } of adrCitations(text)) {
    if (!ADR_FILE.test(path) || reported.has(path)) continue;

    // Prose and comments cite both ways round; a markdown link only ever
    // renders relative to its own file.
    const relative = posix.normalize(posix.join(from, path));
    const target = exists(relative)
      ? relative
      : bare && exists(path)
        ? path
        : undefined;
    // Resolving nowhere is a dead link, which `check-adrs` reports.
    if (target === undefined) continue;

    const cited = owningPackage(target, packages);
    if (cited === owner) continue;

    reported.add(path);
    errors.push(
      `${site(file, text, index)}: cites \`${target}\`, ` +
        (cited === ''
          ? 'a root ADR. Root decisions do not travel with a package — carry the ' +
            'constraint in the prose instead, or move the decision into this package.'
          : `an ADR owned by ${cited}/. A package cites only its own decisions — ` +
            'carry the constraint in the prose instead.'),
    );
  }

  return errors;
}

/** `#126` — but not `#fff`, not `#123456`, and not a heading. */
const ISSUE_NUMBER = /(?<![\w#])#(\d{1,5})(?![\w-])/g;

/**
 * Rule 3: no bare issue number.
 *
 * `#126` is resolved by whichever tracker the reader is looking at, so it means
 * one thing here and something unrelated in every other repo. A *qualified*
 * reference — `https://github.com/<owner>/<repo>/issues/126` — is deliberately
 * left alone: pointing at an upstream project's bug report says the same thing
 * wherever it is read, and one pointing back at this repo's own tracker is
 * content naming this repo, which is the bank's token check to make.
 */
export function validateIssueRefs(file: string, text: string): string[] {
  const errors: string[] = [];

  for (const match of text.matchAll(ISSUE_NUMBER)) {
    errors.push(
      `${site(file, text, match.index)}: references issue \`${match[0]}\`, which resolves ` +
        `to an unrelated issue in any other repo. Delete the number and keep the reason — ` +
        `promoting it into the comment first, if the issue is the only place it is written down.`,
    );
  }

  return errors;
}

/**
 * A token naming an app, matched whole rather than as a substring.
 *
 * The trailing boundary is conditional: `apps/` is a *prefix*, and the thing
 * that names an app is precisely what follows it.
 */
const appPattern = (token: string) => {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tail = /[\w-]$/.test(token) ? '(?![\\w-])' : '';
  return new RegExp(`(?<![\\w/@-])${escaped}${tail}`);
};

/**
 * Rule 4: a root ADR names no app.
 *
 * An app-layer decision filed at the root is a decision packages then cite
 * about content a consumer will never have. Naming an app is the tell.
 */
export function validateRootAdrApps(
  file: string,
  text: string,
  apps: readonly string[],
): string[] {
  const errors: string[] = [];

  for (const token of apps) {
    const match = appPattern(token).exec(text);
    if (!match) continue;
    errors.push(
      `${site(file, text, match.index)}: a root ADR names \`${token}\`. ` +
        `A decision that has to name an app is an app-layer decision — file it under ` +
        `${APPS_DIR}, which the bank never distributes.`,
    );
  }

  return errors;
}

export interface PortableResult {
  readonly violations: Violations;
  /** How many files were read — the denominator the report quotes. */
  readonly scanned: number;
}

/**
 * Every app the workspace holds, as the tokens a root ADR must not use: the
 * directory name, and the package name its manifest declares.
 */
function appTokens(tracked: readonly string[], io: RepoIo): string[] {
  const tokens = new Set([APPS_DIR]);

  for (const file of tracked) {
    const dir = /^apps\/([\w.-]+)\/package\.json$/.exec(file)?.[1];
    if (dir === undefined) continue;
    tokens.add(dir);
    const name = /"name"\s*:\s*"([^"]+)"/.exec(io.read(file))?.[1];
    if (name !== undefined) tokens.add(name);
  }

  return [...tokens].sort();
}

/** Every rule above, over the tracked files `io` reports. */
export function checkPortable(io: RepoIo): PortableResult {
  const tracked = io.tracked();
  const packages = tracked
    .filter((file) => file.endsWith('/package.json'))
    .map((file) => posix.dirname(file));
  const apps = appTokens(tracked, io);
  const errors: string[] = [];
  let scanned = 0;

  for (const file of tracked) {
    if (!carriesCitations(file) || file.startsWith(APPS_DIR)) continue;
    // `CLAUDE.md` and `.github/copilot-instructions.md` are symlinks to
    // `AGENTS.md` — the same text reported three times otherwise.
    if (io.isSymlink(file)) continue;

    const text = io.read(file);
    scanned += 1;

    errors.push(...validateAdrNumbers(file, text));
    errors.push(
      ...validateAdrScope(file, text, packages, (rel) => io.exists(rel)),
    );
    errors.push(...validateIssueRefs(file, text));
    if (file.startsWith(ROOT_ADR_DIR)) {
      errors.push(...validateRootAdrApps(file, text, apps));
    }
  }

  const violations = collectViolations();
  // Sorted, so the report reads by path rather than in traversal order.
  for (const error of [...errors].sort()) violations.error(error);

  return { violations, scanned };
}
