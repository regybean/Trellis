#!/usr/bin/env node
// @ts-check
/**
 * ADR placement, numbering, status and link gate.
 *
 * ADRs live with what they govern: a decision that dies when its package dies
 * belongs to that package's `docs/adr/`, everything else to the repo root's. The
 * rule and its rationale are in `docs/agents/domain.md`; this script enforces
 * the mechanical half of it, and only that half — whether a given ADR is
 * genuinely package-scoped is judgement, and stays documented rather than
 * checked.
 *
 * Hard failures:
 *
 *   1. **Two ADRs sharing a number inside one directory.** Numbering is per
 *      directory, so one counter has one author. Three root numbers had already
 *      collided under a single global sequence; this is what stops it recurring.
 *   2. **A dead ADR reference anywhere** — in an ADR, a `CONTEXT.md`, the context
 *      map, a doc, a lint message, a script comment. ADRs move between
 *      directories, so this check is what makes the next move safe to attempt.
 *   3. **A missing or invalid status line.** Two values: `accepted`, or
 *      `amended by <relative-path>` naming the later ADR whose separable decision
 *      changed this one's. `superseded by` is rejected on purpose — a superseded
 *      ADR is deleted, so it can never be a resting state.
 *   4. **A package owning a `docs/adr/` with no `CONTEXT-MAP.md` row.** A
 *      `CONTEXT.md` is not required (`@acme/ui` owns ADRs and no glossary); the
 *      map row is, or the directory is unreachable from the root.
 *   5. **A `tooling/*` package owning an ADR directory.** Tooling decisions govern
 *      the repo-wide gate rather than the config package, so they live at the root.
 *
 * Warns, and passes, on a gap in a directory's sequence: a gap is the honest
 * trace of a deletion, and hard-failing would force a renumber every time —
 * which re-breaks every link.
 *
 * The same number in the root sequence and in a package's is never flagged.
 * Those are independent counters, and both starting at `0001` is correct.
 *
 * Usage:
 *   node scripts/check-adrs.mjs   # exit 1 naming every violation
 */
import { execFileSync } from "node:child_process";
import { existsSync, globSync, lstatSync, readFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MAP_FILE = "CONTEXT-MAP.md";

/** `0007-package-test-policy.md` — the only shape an ADR filename may take. */
const ADR_FILENAME = /^(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;

/** Files worth reading for references. Anything else is binary or generated. */
const TEXT_EXTENSIONS = new Set([
  "md",
  "mdx",
  "hbs",
  "mjs",
  "cjs",
  "js",
  "jsx",
  "ts",
  "tsx",
  "json",
  "jsonc",
  "yaml",
  "yml",
  "toml",
  "sh",
  "bash",
  "txt",
]);

/** Paths whose contents are vendored from elsewhere and describe no repo tree. */
const SKIPPED_PREFIXES = [".agents/skills/", ".claude/skills/"];

const errors = [];
const warnings = [];

const tracked = execFileSync("git", ["ls-files", "-z"], {
  cwd: ROOT,
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);

// ---------------------------------------------------------------------------
// Directories, numbering, ownership
// ---------------------------------------------------------------------------

/** ADR path -> the `docs/adr` directory holding it, keyed by its owner prefix. */
const directories = new Map();

for (const path of tracked) {
  const match = /^(.*)docs\/adr\/([^/]+)$/.exec(path);
  if (!match) continue;
  const [, owner, filename] = match;
  if (!directories.has(owner)) directories.set(owner, []);
  directories.get(owner).push(filename);
}

for (const [owner, filenames] of [...directories].sort()) {
  const dir = `${owner}docs/adr`;
  const numbers = new Map();

  for (const filename of filenames.sort()) {
    const match = ADR_FILENAME.exec(filename);
    if (!match) {
      errors.push(
        `${dir}/${filename}: not an ADR filename — expected NNNN-kebab-slug.md.`,
      );
      continue;
    }
    const number = match[1];
    if (numbers.has(number)) {
      errors.push(
        `${dir}: two ADRs share the number ${number} — ${numbers.get(number)} and ${filename}. ` +
          `Numbering is per directory; renumber one of them.`,
      );
      continue;
    }
    numbers.set(number, filename);
  }

  const sequence = [...numbers.keys()].map(Number).sort((a, b) => a - b);
  const missing = [];
  for (let n = 1; n < (sequence[sequence.length - 1] ?? 0); n += 1) {
    if (!sequence.includes(n)) missing.push(String(n).padStart(4, "0"));
  }
  if (missing.length > 0) {
    warnings.push(
      `${dir}: sequence gap at ${missing.join(", ")} — expected if an ADR was deleted.`,
    );
  }

  if (owner === "") continue; // the root sequence has no owning package.

  if (owner.startsWith("tooling/")) {
    errors.push(
      `${dir}: tooling/* owns no ADR directory — its decisions govern the repo-wide ` +
        `gate rather than the config package, so they belong in docs/adr/. See docs/agents/domain.md.`,
    );
    continue;
  }

  const mapRow = `\`${owner}\``;
  if (!readFileSync(join(ROOT, MAP_FILE), "utf8").includes(mapRow)) {
    errors.push(
      `${dir}: ${owner} owns ADRs but has no ${MAP_FILE} row (${mapRow}) — the directory is unreachable from the root.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Status lines
// ---------------------------------------------------------------------------

/**
 * `accepted`, or `amended by <path>`, each with an optional trailing note. The
 * note is where the provenance a single word cannot carry goes — which ticket,
 * or what the amendment changed.
 */
const STATUS_LINE =
  /^\*\*Status:\*\* (?:(accepted)|amended by (\S+?))(?:[.,]?\s+[—(].*)?[.]?$/;

for (const [owner, filenames] of directories) {
  for (const filename of filenames) {
    const path = `${owner}docs/adr/${filename}`;
    const lines = readFileSync(join(ROOT, path), "utf8").split("\n");

    if (lines.some((line) => /^#{2,}\s+Status\b/.test(line))) {
      errors.push(
        `${path}: has a "## Status" section — an ADR carries exactly one status, ` +
          `on the **Status:** line under its title.`,
      );
    }

    const line = lines.slice(1).find((candidate) => candidate.trim() !== "");
    if (line === undefined || !line.startsWith("**Status:**")) {
      errors.push(
        `${path}: no status line under the title — add "**Status:** accepted" or ` +
          `"**Status:** amended by <relative-path>".`,
      );
      continue;
    }

    if (/superseded by/i.test(line)) {
      errors.push(
        `${path}: status says "superseded by". A superseded ADR is deleted, not kept — ` +
          `delete it, or edit the decision in place and keep the status "accepted".`,
      );
      continue;
    }

    const status = STATUS_LINE.exec(line);
    if (!status) {
      errors.push(
        `${path}: unreadable status "${line.trim()}" — the value must be "accepted" or ` +
          `"amended by <relative-path>", optionally followed by a note.`,
      );
      continue;
    }

    const amendedBy = status[2];
    if (amendedBy && !existsSync(resolve(ROOT, dirname(path), amendedBy))) {
      errors.push(
        `${path}: status names "${amendedBy}", which does not exist relative to ${dirname(path)}/.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

/** `[text](target)`, target only, with any markdown link title dropped. */
const MARKDOWN_LINK = /\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g;

/**
 * A repo-relative ADR path written as prose or in a comment. Prose cites some
 * ADRs by number alone ("see docs/adr/0017"), which stales the same way a full
 * path does, so the trailing slug is optional.
 */
const BARE_PATH =
  /(?<![\w./-])((?:\.{1,2}\/)*(?:[\w.-]+\/)*docs\/adr\/[^\s`)("'<>,\]*]*)/g;

/**
 * Fenced code blocks hold illustrations, not references to this tree.
 * @param {string} text
 */
function withoutCodeFences(text) {
  return text.replace(/^```[\s\S]*?^```/gm, "");
}

/**
 * Whether a reference target points at an ADR file, number or directory.
 * @param {string} target
 */
function isAdrReference(target) {
  if (/^[a-z][\w+.-]*:/i.test(target) || target.startsWith("#")) return false;
  return (
    target.includes("docs/adr/") || ADR_FILENAME.test(posix.basename(target))
  );
}

/**
 * Whether a repo-relative candidate names something real. A candidate ending in
 * a bare number is a citation by number, and matches any ADR carrying it — the
 * slug can be rewritten without breaking the citation, the number cannot.
 * @param {string} candidate
 */
function resolves(candidate) {
  if (existsSync(join(ROOT, candidate))) return true;
  const byNumber = /^(.*docs\/adr)\/(\d{4})$/.exec(candidate);
  if (!byNumber) return false;
  return globSync(join(ROOT, byNumber[1], `${byNumber[2]}-*.md`)).length > 0;
}

for (const path of tracked) {
  if (SKIPPED_PREFIXES.some((prefix) => path.startsWith(prefix))) continue;
  const extension = posix.extname(path).slice(1);
  if (!TEXT_EXTENSIONS.has(extension)) continue;
  // A symlink's content belongs to its target, where it is already checked —
  // and its relative links only resolve from there (.github/copilot-instructions.md).
  if (lstatSync(join(ROOT, path)).isSymbolicLink()) continue;

  const raw = readFileSync(join(ROOT, path), "utf8");
  const text = /^(md|mdx|hbs)$/.test(extension) ? withoutCodeFences(raw) : raw;
  const from = dirname(path);

  /**
   * A markdown link is relative to its own file — that is what makes it
   * clickable. A path written in prose or a comment is relative to no
   * particular directory: source comments say "this package's docs/adr/0001-…"
   * and docs say "docs/adr/0020-…" meaning the root, so a bare path is offered
   * every enclosing directory.
   */
  const enclosing = [];
  for (let dir = from; dir !== "."; dir = posix.dirname(dir))
    enclosing.push(dir);

  const references = [];
  for (const [, target] of text.matchAll(MARKDOWN_LINK)) {
    references.push({ target, roots: [from] });
  }
  for (const [, target] of text.matchAll(BARE_PATH)) {
    references.push({ target, roots: [".", ...enclosing] });
  }

  for (const { target, roots } of references) {
    if (!isAdrReference(target)) continue;
    // Prose runs a citation into its sentence; markdown allows an anchor.
    const cited = target.split("#")[0].replace(/[.,;:!]+$/, "");
    if (cited === "") continue;
    const candidates = cited.startsWith("/")
      ? [cited.slice(1)]
      : roots.map((root) => posix.join(root, cited));
    if (candidates.some(resolves)) continue;
    errors.push(
      `${path}: dead ADR reference "${cited}" — nothing at ` +
        `${candidates.join(" or ")}.`,
    );
  }
}

// ---------------------------------------------------------------------------

for (const warning of [...new Set(warnings)].sort()) {
  console.warn(`⚠️  ${warning}`);
}

if (errors.length > 0) {
  console.error(
    `\ncheck-adrs: ${errors.length} problem${errors.length === 1 ? "" : "s"}.\n`,
  );
  for (const error of [...new Set(errors)].sort())
    console.error(`  ✖ ${error}`);
  console.error(
    `\nThe placement and status rules are in docs/agents/domain.md.`,
  );
  process.exit(1);
}

const count = [...directories.values()].reduce(
  (total, filenames) => total + filenames.length,
  0,
);
console.log(
  `check-adrs: ${count} ADRs across ${directories.size} directories — numbering, status and references OK.`,
);
