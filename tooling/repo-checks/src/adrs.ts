/**
 * ADR hygiene.
 *
 * ADRs live with what they govern: repo-wide decisions in `docs/adr/`, a
 * package's own in its `docs/adr/`, numbered **per directory** from `0001`
 * ([placement rule](../../../docs/agents/domain.md#where-an-adr-lives)). That
 * layout only holds if four things are mechanical, because each of them has
 * already drifted once:
 *
 *   1. **No duplicate number inside a directory.** Three root numbers collided
 *      when one global counter had more than one author. Per-directory
 *      sequences make the collision impossible to repeat — but only if
 *      something counts.
 *   2. **No dead ADR link.** Moving an ADR is the routine operation now, so the
 *      thing that makes a move safe to attempt is knowing every citation still
 *      resolves. Checked everywhere: ADRs, `CONTEXT.md`, `CONTEXT-MAP.md`,
 *      docs, and source comments.
 *   3. **A status the vocabulary allows** — `accepted` or `amended by <path>`,
 *      and the amending path resolves. `superseded by` is rejected on purpose:
 *      a superseded ADR is deleted, so it can never be a resting state.
 *   4. **A `CONTEXT-MAP.md` row for every package owning ADRs.** Otherwise a
 *      package's reasoning exists but nothing points at it.
 *
 * A **gap** in a sequence only warns. It is the honest trace of a deletion, and
 * hard-failing would force a renumber every time — which re-breaks the links
 * rule 2 exists to protect.
 *
 * Root and package sequences are independent: the same number in `docs/adr/`
 * and in a package is normal and is never flagged.
 *
 * Whether an ADR is *genuinely* package-scoped is judgement, and stays
 * documented rather than enforced.
 *
 * Every rule below is a function of the text or the filenames it reads. The
 * checker used to shell out to git at module load, which put even the pure
 * numbering rules out of reach of a test.
 */
import { posix } from 'node:path';

import type { Violations } from '@acme/workspace-graph';
import { collectViolations } from '@acme/workspace-graph';

import type { RepoIo } from './io';

const ADR_SEGMENT = 'docs/adr/';

/** Where the placement and status rules are written down. */
export const ADRS_HELP =
  'The placement and status rules are in docs/agents/domain.md.';

/** The root map that has to point at a package's ADR directory. */
export const CONTEXT_MAP = 'CONTEXT-MAP.md';

/** `0001-slug.md` — the only shape a number can be read off. */
const ADR_FILENAME = /^(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;

/** Files whose text can carry an ADR citation. Binaries and lockfiles cannot. */
const TEXT_EXTENSIONS = new Set([
  'bash',
  'cjs',
  'cts',
  'hbs',
  'js',
  'json',
  'jsonc',
  'jsx',
  'md',
  'mdx',
  'mjs',
  'mts',
  'sh',
  'toml',
  'ts',
  'tsx',
  'txt',
  'yaml',
  'yml',
  'zsh',
]);

/** An ADR directory, and what it owns. */
export interface AdrDirectory {
  /** Repo-relative path of the directory itself, `docs/adr` included. */
  readonly dir: string;
  /** The package (or app) it belongs to — empty for the repo root. */
  readonly owner: string;
  /** The filenames in it, sorted. */
  readonly files: readonly string[];
}

export interface RuleResult {
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

/**
 * Every `docs/adr/` directory in a list of repo-relative paths, sorted by path.
 *
 * A pure reading of the file list, so the numbering rules below are reachable
 * from ADR filenames alone — no git, no disk.
 */
export function adrDirectories(files: readonly string[]): AdrDirectory[] {
  const dirs = new Map<string, { owner: string; files: string[] }>();

  for (const file of files) {
    const at = file.indexOf(ADR_SEGMENT);
    if (at === -1) continue;
    // `docs/adr/` must be a path prefix, not a substring of a longer segment.
    if (at !== 0 && file[at - 1] !== '/') continue;
    const dir = file.slice(0, at + ADR_SEGMENT.length - 1);
    const entry = dirs.get(dir) ?? {
      owner: file.slice(0, Math.max(at - 1, 0)),
      files: [],
    };
    entry.files.push(file.slice(at + ADR_SEGMENT.length));
    dirs.set(dir, entry);
  }

  return [...dirs]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([dir, { owner, files: names }]) => ({
      dir,
      owner,
      files: [...names].sort(),
    }));
}

/** Rule 1: numbering is per directory — no duplicates, gaps only warn. */
export function validateNumbering(
  dir: string,
  files: readonly string[],
): RuleResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const byNumber = new Map<number, string[]>();

  for (const name of [...files].sort()) {
    const match = ADR_FILENAME.exec(name);
    if (!match?.[1]) {
      errors.push(
        `${dir}/${name}: not named \`NNNN-kebab-slug.md\`, so it carries no number. ` +
          `Rename it, or move it out of the ADR directory.`,
      );
      continue;
    }
    const number = Number(match[1]);
    byNumber.set(number, [...(byNumber.get(number) ?? []), name]);
  }

  for (const [number, names] of [...byNumber].sort((a, b) => a[0] - b[0])) {
    if (names.length > 1) {
      errors.push(
        `${dir}/ has ${names.length} ADRs numbered ${String(number).padStart(4, '0')}: ` +
          `${names.join(', ')}. Numbers are unique per directory — renumber all but one ` +
          `to the next free number in this directory.`,
      );
    }
  }

  const present = [...byNumber.keys()].sort((a, b) => a - b);
  const highest = present.at(-1);
  if (highest === undefined) return { errors, warnings };

  const gaps: string[] = [];
  for (let number = 1; number < highest; number += 1) {
    if (!byNumber.has(number)) gaps.push(String(number).padStart(4, '0'));
  }
  if (gaps.length > 0) {
    warnings.push(
      `${dir}/ skips ${gaps.join(', ')} — expected if those ADRs were deleted; ` +
        `don't renumber to close a gap.`,
    );
  }

  return { errors, warnings };
}

// The value is trimmed at the call site rather than matched with a `\s*$`
// tail, which the `\s*` before the capture can also claim — polynomial
// backtracking on a line that turns out not to match.
const STATUS_LINE = /^\*\*Status:\*\*\s*(.+)$/;

/**
 * The machine-readable half of a status, with any human note stripped: an
 * em-dash clause or a parenthetical may follow the value, and both are free
 * prose.
 */
export function statusValue(raw: string): string {
  const [beforeNote = ''] = raw.split(' — ');
  const [value = ''] = beforeNote.split(' (');
  return value
    .replace(/[.,;]$/, '')
    .trim()
    .toLowerCase();
}

/**
 * Rule 3: the status vocabulary.
 *
 * @param resolves Whether a path named as the amending ADR resolves from the
 * ADR's own directory. Injected, so the vocabulary is assertable without disk.
 */
export function validateStatus(
  path: string,
  text: string,
  resolves: (amendingPath: string) => boolean,
): string[] {
  const lines = text.split('\n');
  // The status is the first non-empty line under the H1 title.
  const first = lines.findIndex(
    (line, index) => index > 0 && line.trim() !== '',
  );
  const line = first === -1 ? undefined : lines[first];
  const raw = line ? (STATUS_LINE.exec(line)?.[1]?.trim() ?? '') : '';

  if (!raw) {
    return [
      `${path}: no \`**Status:**\` line under the title. Add one directly below the ` +
        `\`# \` heading, reading \`**Status:** accepted\` or \`**Status:** amended by <path>\`.`,
    ];
  }

  const value = statusValue(raw);

  if (value.startsWith('superseded by')) {
    return [
      `${path}: status is \`superseded by\`, which the vocabulary does not allow. ` +
        `A superseded ADR is deleted, not kept — so either delete this file, or, if ` +
        `only part of the decision changed, edit it in place and set ` +
        `\`amended by <path-to-the-amending-adr>\`.`,
    ];
  }

  if (value === 'accepted') return [];

  const amended = /^amended by\s+(\S+)$/.exec(value);
  if (!amended?.[1]) {
    return [
      `${path}: status \`${raw}\` is not in the vocabulary. It must read ` +
        `\`accepted\` or \`amended by <path>\`, either optionally followed by ` +
        `\` — <note>\` or a parenthetical.`,
    ];
  }

  if (!resolves(amended[1])) {
    return [
      `${path}: status names \`${amended[1]}\` as the amending ADR, but that path ` +
        `does not resolve from ${posix.dirname(path)}/.`,
    ];
  }

  return [];
}

/** A markdown link target: `](./some/path.md#anchor)`. */
const MARKDOWN_LINK = /\]\(\s*([^)\s]+)/g;

/**
 * A bare ADR path in prose or a source comment, outside any markdown link.
 *
 * The filename's dots are their own segments rather than members of the class
 * before `\.md`, where a `.` could be claimed by either and made the match
 * polynomial on a long run of `-`.
 */
const BARE_ADR_PATH =
  /(?:\.{1,2}\/)*(?:[\w.@-]+\/)*docs\/adr\/\d{4}-[\w-]+(?:\.[\w-]+)*\.md/g;

/** Does this link target name an ADR file, or an ADR directory? */
const isAdrTarget = (target: string) =>
  /(^|\/)adr\/$/.test(target) || /(^|\/)\d{4}-[\w.-]*\.md$/.test(target);

/** Whether a file's text can carry a citation at all. */
export function carriesCitations(file: string): boolean {
  const extension = file.split('.').pop()?.toLowerCase() ?? '';
  return TEXT_EXTENSIONS.has(extension);
}

/**
 * Rule 2: every ADR citation in one file resolves.
 *
 * @param exists Whether a repo-relative path exists. Injected, so a citation
 * and its target are a pair of values rather than a repo on disk.
 */
export function validateCitations(
  file: string,
  text: string,
  exists: (rel: string) => boolean,
): string[] {
  const errors: string[] = [];
  const from = posix.dirname(file);
  // A template's links are relative to where it *renders*, not where it lives,
  // and the generator knows that destination — so judge those by the file the
  // path names rather than the directory it is written from.
  const isTemplate = file.endsWith('.hbs');
  const reported = new Set<string>();

  /** A citation is dead only when it resolves nowhere plausible. */
  const dead = (target: string, rootRelativeToo: boolean) => {
    if (exists(posix.join(from, target))) return false;
    if (isTemplate && exists(target.replace(/^(\.\.\/)+/, ''))) return false;
    return !(rootRelativeToo && exists(target));
  };

  for (const match of text.matchAll(MARKDOWN_LINK)) {
    const [path = ''] = (match[1] ?? '').split('#');
    if (!path || /^[a-z][a-z0-9+.-]*:/i.test(path)) continue;
    if (!isAdrTarget(path)) continue;
    // A markdown link renders relative to its own file, and only that.
    if (dead(path, false) && !reported.has(path)) {
      reported.add(path);
      errors.push(`${file}: link to \`${path}\` resolves to no file.`);
    }
  }

  for (const [path] of text.matchAll(BARE_ADR_PATH)) {
    // Prose and comments cite both ways round, so accept either reading.
    if (dead(path, true) && !reported.has(path)) {
      reported.add(path);
      errors.push(`${file}: reference to \`${path}\` resolves to no file.`);
    }
  }

  return errors;
}

/** Rule 4: a package owning ADRs has a `CONTEXT-MAP.md` row. */
export function validateMapRows(
  directories: readonly AdrDirectory[],
  mapText: string,
): string[] {
  const errors: string[] = [];
  for (const { dir, owner } of directories) {
    if (!owner) continue; // the root directory is the map's `## System-wide` list
    if (mapText.includes(`${dir}/`)) continue;
    errors.push(
      `${owner}/ owns ADRs in ${dir}/ but ${CONTEXT_MAP} has no row linking them. ` +
        `Add the row — a \`CONTEXT.md\` is not required, an ADR directory alone is enough.`,
    );
  }
  return errors;
}

export interface AdrResult {
  readonly violations: Violations;
  readonly directories: readonly AdrDirectory[];
  /** How many ADRs there are, across every directory. */
  readonly total: number;
}

/** Every rule above, over the tracked files `io` reports. */
export function checkAdrs(io: RepoIo): AdrResult {
  const tracked = io.tracked();
  const directories = adrDirectories(tracked);
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const { dir, files } of directories) {
    const numbering = validateNumbering(dir, files);
    errors.push(...numbering.errors);
    warnings.push(...numbering.warnings);

    for (const name of files) {
      if (!ADR_FILENAME.test(name)) continue;
      const path = `${dir}/${name}`;
      errors.push(
        ...validateStatus(path, io.read(path), (amendingPath) =>
          io.exists(posix.join(dir, amendingPath)),
        ),
      );
    }
  }

  for (const file of tracked) {
    if (!carriesCitations(file)) continue;
    // `.github/copilot-instructions.md` is a symlink to `CLAUDE.md`; checking
    // the same content twice would report every hit against a path that has no
    // body.
    if (io.isSymlink(file)) continue;
    errors.push(
      ...validateCitations(file, io.read(file), (rel) => io.exists(rel)),
    );
  }

  if (io.exists(CONTEXT_MAP)) {
    errors.push(...validateMapRows(directories, io.read(CONTEXT_MAP)));
  }

  const violations = collectViolations();
  // Sorted, so the report reads alphabetically rather than in traversal order.
  for (const warning of [...warnings].sort()) violations.warn(warning);
  for (const error of [...errors].sort()) violations.error(error);

  return {
    violations,
    directories,
    total: directories.reduce((sum, { files }) => sum + files.length, 0),
  };
}
