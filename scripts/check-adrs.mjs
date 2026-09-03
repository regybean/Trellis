#!/usr/bin/env node
// @ts-check
/**
 * ADR hygiene gate.
 *
 * ADRs live with what they govern: repo-wide decisions in `docs/adr/`, a
 * package's own in its `docs/adr/`, numbered **per directory** from `0001`
 * ([placement rule](../docs/agents/domain.md#where-an-adr-lives)). That layout
 * only holds if four things are mechanical, because each of them has already
 * drifted once:
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
 * Usage:
 *   node scripts/check-adrs.mjs [repo-root]   # exit 1 on any violation
 */
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.argv[2]
  ? resolve(process.argv[2])
  : join(dirname(fileURLToPath(import.meta.url)), "..");

const CONTEXT_MAP = "CONTEXT-MAP.md";
const PLACEMENT_DOC = "docs/agents/domain.md";

/** `0001-slug.md` — the only shape a number can be read off. */
const ADR_FILENAME = /^(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;

/** Files whose text can carry an ADR citation. Binaries and lockfiles cannot. */
const TEXT_EXTENSIONS = new Set([
  "bash",
  "cjs",
  "cts",
  "hbs",
  "js",
  "json",
  "jsonc",
  "jsx",
  "md",
  "mdx",
  "mjs",
  "mts",
  "sh",
  "toml",
  "ts",
  "tsx",
  "txt",
  "yaml",
  "yml",
  "zsh",
]);

const errors = [];
const warnings = [];

/** Tracked files, so untracked working dirs and `node_modules` never reach us. */
const tracked = execFileSync("git", ["ls-files", "-z"], {
  cwd: ROOT,
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);

// ---------------------------------------------------------------------------
// The ADR directories, and what each one owns
// ---------------------------------------------------------------------------

/**
 * Every `docs/adr/` directory, keyed by its repo-relative path. `owner` is the
 * package (or app) the directory belongs to — empty for the repo root.
 *
 * @type {Map<string, { owner: string, files: string[] }>}
 */
const adrDirs = new Map();

for (const file of tracked) {
  const at = file.indexOf("docs/adr/");
  if (at === -1) continue;
  // `docs/adr/` must be a path prefix, not a substring of a longer segment.
  if (at !== 0 && file[at - 1] !== "/") continue;
  const dir = file.slice(0, at + "docs/adr/".length - 1);
  const entry = adrDirs.get(dir) ?? {
    owner: file.slice(0, Math.max(at - 1, 0)),
    files: [],
  };
  entry.files.push(file.slice(at + "docs/adr/".length));
  adrDirs.set(dir, entry);
}

// ---------------------------------------------------------------------------
// Rule 1 — numbering is per directory: no duplicates, gaps only warn
// ---------------------------------------------------------------------------

for (const [dir, { files }] of [...adrDirs].sort()) {
  /** @type {Map<number, string[]>} */
  const byNumber = new Map();

  for (const name of files.sort()) {
    const match = ADR_FILENAME.exec(name);
    if (!match) {
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
        `${dir}/ has ${names.length} ADRs numbered ${String(number).padStart(4, "0")}: ` +
          `${names.join(", ")}. Numbers are unique per directory — renumber all but one ` +
          `to the next free number in this directory.`,
      );
    }
  }

  const present = [...byNumber.keys()].sort((a, b) => a - b);
  if (!present.length) continue;
  const gaps = [];
  for (let n = 1; n < present[present.length - 1]; n += 1) {
    if (!byNumber.has(n)) gaps.push(String(n).padStart(4, "0"));
  }
  if (gaps.length) {
    warnings.push(
      `${dir}/ skips ${gaps.join(", ")} — expected if those ADRs were deleted; ` +
        `don't renumber to close a gap.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Rule 3 — the status vocabulary
// ---------------------------------------------------------------------------

const STATUS_LINE = /^\*\*Status:\*\*\s*(.+?)\s*$/;

/**
 * The machine-readable half of a status, with any human note stripped: an em-dash
 * clause or a parenthetical may follow the value, and both are free prose.
 *
 * @param {string} raw
 */
function statusValue(raw) {
  return raw
    .split(" — ")[0]
    .split(" (")[0]
    .replace(/[.,;]$/, "")
    .trim()
    .toLowerCase();
}

for (const [dir, { files }] of [...adrDirs].sort()) {
  for (const name of files.sort()) {
    if (!ADR_FILENAME.test(name)) continue;
    const path = `${dir}/${name}`;
    const lines = readFileSync(join(ROOT, path), "utf8").split("\n");

    // The status is the first non-empty line under the H1 title.
    const first = lines.findIndex(
      (line, index) => index > 0 && line.trim() !== "",
    );
    const raw = first === -1 ? "" : (STATUS_LINE.exec(lines[first])?.[1] ?? "");

    if (!raw) {
      errors.push(
        `${path}: no \`**Status:**\` line under the title. Add one directly below the ` +
          `\`# \` heading, reading \`**Status:** accepted\` or \`**Status:** amended by <path>\`.`,
      );
      continue;
    }

    const value = statusValue(raw);

    if (value.startsWith("superseded by")) {
      errors.push(
        `${path}: status is \`superseded by\`, which the vocabulary does not allow. ` +
          `A superseded ADR is deleted, not kept — so either delete this file, or, if ` +
          `only part of the decision changed, edit it in place and set ` +
          `\`amended by <path-to-the-amending-adr>\`.`,
      );
      continue;
    }

    if (value === "accepted") continue;

    const amended = /^amended by\s+(\S+)$/.exec(value);
    if (!amended) {
      errors.push(
        `${path}: status \`${raw}\` is not in the vocabulary. It must read ` +
          `\`accepted\` or \`amended by <path>\`, either optionally followed by ` +
          `\` — <note>\` or a parenthetical.`,
      );
      continue;
    }

    if (!existsSync(join(ROOT, dir, amended[1]))) {
      errors.push(
        `${path}: status names \`${amended[1]}\` as the amending ADR, but that path ` +
          `does not resolve from ${dir}/.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Rule 2 — every ADR citation resolves, anywhere in the repo
// ---------------------------------------------------------------------------

/** A markdown link target: `](./some/path.md#anchor)`. */
const MARKDOWN_LINK = /\]\(\s*([^)\s]+)/g;

/** A bare ADR path in prose or a source comment, outside any markdown link. */
const BARE_ADR_PATH =
  /(?:\.{1,2}\/)*(?:[\w.@-]+\/)*docs\/adr\/\d{4}-[\w.-]+\.md/g;

/** Does this link target name an ADR file, or an ADR directory? */
function isAdrTarget(target) {
  return /(^|\/)adr\/$/.test(target) || /(^|\/)\d{4}-[\w.-]*\.md$/.test(target);
}

for (const file of tracked) {
  const extension = file.split(".").pop()?.toLowerCase() ?? "";
  if (!TEXT_EXTENSIONS.has(extension)) continue;
  // `.github/copilot-instructions.md` is a symlink to `CLAUDE.md`; checking the
  // same content twice would report every hit against a path that has no body.
  if (lstatSync(join(ROOT, file)).isSymbolicLink()) continue;

  const text = readFileSync(join(ROOT, file), "utf8");
  const from = posix.dirname(file);
  // A template's links are relative to where it *renders*, not where it lives,
  // and the generator knows that destination — so judge those by the file the
  // path names rather than the directory it is written from.
  const isTemplate = extension === "hbs";
  /** @type {Set<string>} */
  const reported = new Set();

  /** A citation is dead only when it resolves nowhere plausible. */
  const dead = (target, rootRelativeToo) => {
    if (existsSync(join(ROOT, from, target))) return false;
    if (
      isTemplate &&
      existsSync(join(ROOT, target.replace(/^(\.\.\/)+/, "")))
    ) {
      return false;
    }
    return !(rootRelativeToo && existsSync(join(ROOT, target)));
  };

  for (const [, target] of text.matchAll(MARKDOWN_LINK)) {
    const path = target.split("#")[0];
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
}

// ---------------------------------------------------------------------------
// Rule 4 — a package owning ADRs has a CONTEXT-MAP.md row
// ---------------------------------------------------------------------------

if (existsSync(join(ROOT, CONTEXT_MAP))) {
  const map = readFileSync(join(ROOT, CONTEXT_MAP), "utf8");
  for (const [dir, { owner }] of [...adrDirs].sort()) {
    if (!owner) continue; // the root directory is the map's `## System-wide` list
    if (map.includes(`${dir}/`)) continue;
    errors.push(
      `${owner}/ owns ADRs in ${dir}/ but ${CONTEXT_MAP} has no row linking them. ` +
        `Add the row — a \`CONTEXT.md\` is not required, an ADR directory alone is enough.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

for (const warning of warnings.sort()) console.warn(`  warn: ${warning}`);

if (errors.length) {
  console.error(
    `\n✖ check-adrs found ${errors.length} ${errors.length === 1 ? "problem" : "problems"}:\n`,
  );
  for (const error of errors.sort()) console.error(`  ${error}`);
  console.error(`\nThe placement and status rules are in ${PLACEMENT_DOC}.\n`);
  process.exit(1);
}

const total = [...adrDirs.values()].reduce(
  (sum, { files }) => sum + files.length,
  0,
);
console.log(
  `check-adrs: ${total} ADRs across ${adrDirs.size} ${adrDirs.size === 1 ? "directory" : "directories"} — numbering, statuses, links and map rows all clean.`,
);
