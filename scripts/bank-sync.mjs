#!/usr/bin/env node
// @ts-check
/**
 * Bank sync — rebuild the pristine vendor branch from a filtered bank subset.
 *
 * Reads `bank.manifest.json` (see docs/adr/0037-vendored-git-subset-three-way-merge.md),
 * fetches the bank at `ref`, and rewrites the local `vendor/trellis` branch so
 * its tree is bank@ref filtered down to `include` and nothing else. The new
 * commit's parent is the previous vendor commit, so the previous sync is a
 * genuine merge base and `git merge` is an ordinary three-way merge.
 *
 * It stops there. It never merges, never checks anything out, and never touches
 * the working tree or the index — the rewrite runs entirely through plumbing
 * against a throwaway index file, so it is safe to run on a dirty branch. The
 * merge command is printed for the human to run.
 *
 * `--check` writes nothing at all. It reports how far the pinned `ref` is behind
 * the bank's default branch, which `include` paths moved in between, and which
 * vendored paths this repo has modified since its last merge. The bank cannot
 * see its consumers, so drift detection is consumer-side by construction — see
 * docs/bank.md for the guide, and the exit codes below for gating CI on it.
 *
 * This is the pull half. Back-flow is `scripts/bank-contribute.mjs`, which is
 * separate on purpose: pulling from a public bank is always safe, contributing
 * to it is the constrained direction.
 *
 * Usage:
 *   node scripts/bank-sync.mjs             # or: pnpm bank:sync
 *   node scripts/bank-sync.mjs --check     # or: pnpm bank:sync --check
 *
 * Exit codes (`--check`):
 *   0  up to date — nothing unpulled
 *   1  error — bad manifest, unreachable bank, unresolvable ref
 *   2  behind — the bank has commits this repo has not taken
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  BankError,
  MANIFEST,
  VENDOR_BRANCH,
  VENDOR_REF,
  defaultBranch,
  enterRepoRoot,
  fail,
  fetchBank,
  git,
  gitOrNull,
  readManifest,
  under,
  vendorCommitMessage,
} from "./lib/bank.mjs";

/** `--check` outcomes. Documented in docs/bank.md, so any CI can gate on them. */
const EXIT_UP_TO_DATE = 0;
const EXIT_ERROR = 1;
const EXIT_BEHIND = 2;

/**
 * Build a tree holding exactly the `include` paths of `sha`.
 *
 * `ls-tree` gives one line per file (`<mode> <type> <sha>\t<path>`); the kept
 * lines are replayed into a throwaway index, which is written back out as a
 * tree. Modes carry through untouched, so executable bits, symlinks and
 * submodule gitlinks all survive the filter.
 *
 * @param {string} root
 * @param {string} sha
 * @param {string[]} include
 * @param {{ quiet?: boolean }} [options] `--check` builds a tree only to compare
 *   it, so it suppresses the unmatched-prefix warnings a sync should print.
 * @returns {string}
 */
function buildFilteredTree(root, sha, include, options = {}) {
  const entries = git(["ls-tree", "-r", "-z", sha], {
    cwd: root,
    maxBuffer: 256 * 1024 * 1024,
  })
    .split("\0")
    .filter(Boolean)
    .map((line) => {
      const [meta, path] = line.split("\t");
      const [mode, , object] = meta.split(" ");
      return { mode, object, path };
    })
    .filter((entry) => include.some((prefix) => under(entry.path, prefix)));

  if (entries.length === 0)
    return fail(
      `nothing at ${sha.slice(0, 8)} matches "include" — the vendor branch would be empty`,
    );

  if (!options.quiet)
    for (const prefix of include)
      if (!entries.some((entry) => under(entry.path, prefix)))
        console.warn(
          `bank:sync: warning — "include" entry ${prefix} matched nothing upstream`,
        );

  const indexDir = mkdtempSync(join(tmpdir(), "bank-sync-"));
  try {
    const env = { ...process.env, GIT_INDEX_FILE: join(indexDir, "index") };
    git(["update-index", "--index-info"], {
      cwd: root,
      env,
      input: entries
        .map((entry) => `${entry.mode} ${entry.object}\t${entry.path}`)
        .join("\n"),
    });
    return git(["write-tree"], { cwd: root, env });
  } finally {
    rmSync(indexDir, { recursive: true, force: true });
  }
}

/**
 * NUL-separated `git diff` output, restricted to the subscribed paths.
 *
 * @param {string[]} args `git diff` arguments naming the two sides.
 * @param {string[]} include
 * @returns {string[]}
 */
function diffFields(args, include) {
  return git(["diff", "-z", ...args, "--", ...include], {
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter(Boolean);
}

/**
 * Roll changed files up to the `include` entries that own them. The question is
 * which subscribed paths moved, and a package-level answer stays readable where
 * nine months of file names does not.
 *
 * @param {string[]} files
 * @param {string[]} include
 * @returns {{ prefix: string, files: number }[]}
 */
function byIncludePath(files, include) {
  return include
    .map((prefix) => ({
      prefix,
      files: files.filter((file) => under(file, prefix)).length,
    }))
    .filter((entry) => entry.files > 0);
}

/**
 * What this repo has changed in vendored paths since its last merge.
 *
 * The baseline is the merge base of `HEAD` and the vendor branch — the last
 * vendor commit actually merged in. Diffing against the vendor branch tip
 * instead would report every unmerged upstream change as a local modification.
 *
 * @param {string} vendor
 * @param {string[]} include
 * @returns {{ merged: false } | { merged: true, entries: { status: string, path: string }[] }}
 */
function localModifications(vendor, include) {
  const base = gitOrNull(["merge-base", "HEAD", vendor]);
  if (!base) return { merged: false };

  // `--name-status -z` emits status and path as separate NUL-terminated fields.
  const fields = diffFields(["--name-status", base, "HEAD"], include);
  /** @type {{ status: string, path: string }[]} */
  const entries = [];
  for (let i = 0; i + 1 < fields.length; i += 2)
    entries.push({ status: fields[i], path: fields[i + 1] });
  return { merged: true, entries };
}

/**
 * Report drift and exit. Writes nothing: it fetches into the object store and
 * reads refs, and never touches `vendor/trellis`, the index or the working
 * tree.
 *
 * @param {string} root
 * @param {import("./lib/bank.mjs").Manifest} manifest
 * @returns {never}
 */
function runCheck(root, manifest) {
  const pinned = fetchBank(manifest.upstream, manifest.ref);
  const headRef = defaultBranch(manifest.upstream);
  const head = fetchBank(manifest.upstream, headRef);

  const behind = Number(git(["rev-list", "--count", `${pinned}..${head}`]));
  const moved = behind
    ? byIncludePath(
        diffFields(["--name-only", pinned, head], manifest.include),
        manifest.include,
      )
    : [];

  const vendor = gitOrNull(["rev-parse", "--verify", "--quiet", VENDOR_REF]);
  const vendorTree = vendor && gitOrNull(["rev-parse", `${vendor}^{tree}`]);
  const unsynced =
    vendorTree !==
    buildFilteredTree(root, pinned, manifest.include, { quiet: true });
  const local = vendor
    ? localModifications(vendor, manifest.include)
    : undefined;

  const lines = [
    `bank:     ${manifest.upstream}`,
    `pinned:   ${manifest.ref} (${pinned.slice(0, 8)})`,
    `bank tip: ${headRef} (${head.slice(0, 8)})`,
    "",
  ];

  if (behind)
    lines.push(
      `Behind by ${behind} bank commit${behind === 1 ? "" : "s"}. "include" paths that changed in them:`,
      ...moved.map(
        (entry) =>
          `  ${entry.prefix} (${entry.files} file${entry.files === 1 ? "" : "s"})`,
      ),
      "",
      `To take them: point "ref" in ${MANIFEST} at the newest bank tag, then run pnpm bank:sync.`,
      "",
    );

  if (unsynced)
    lines.push(
      vendor
        ? `${VENDOR_BRANCH} does not hold the pinned ref — run pnpm bank:sync to rebuild it.`
        : `${VENDOR_BRANCH} does not exist — this repo has never synced. Run pnpm bank:sync.`,
      "",
    );

  if (local && !local.merged)
    lines.push(
      `${VENDOR_BRANCH} has never been merged, so local modifications cannot be reported yet.`,
      "",
    );

  if (local?.merged && local.entries.length)
    lines.push(
      "Locally modified vendored paths:",
      ...local.entries.map((entry) => `  ${entry.status}  ${entry.path}`),
      "",
      "Review these and consider contributing them back to the bank — anything generic",
      "here is a fix every other consumer is currently missing.",
      "",
    );

  const clean =
    !behind && !unsynced && (!local || (local.merged && !local.entries.length));

  if (clean)
    console.log(
      `Up to date with ${manifest.ref} (${pinned.slice(0, 8)}) — nothing unpulled, no locally modified vendored paths.`,
    );
  else console.log(lines.join("\n").trimEnd());

  process.exit(behind || unsynced ? EXIT_BEHIND : EXIT_UP_TO_DATE);
}

/**
 * Rewrite `vendor/trellis` to the filtered bank subset, then print the merge
 * command for the human to run.
 *
 * @param {string} root
 * @param {import("./lib/bank.mjs").Manifest} manifest
 */
function runSync(root, manifest) {
  const bankSha = fetchBank(manifest.upstream, manifest.ref);
  const tree = buildFilteredTree(root, bankSha, manifest.include);

  const parent = gitOrNull(["rev-parse", "--verify", "--quiet", VENDOR_REF]);
  if (parent && gitOrNull(["rev-parse", `${parent}^{tree}`]) === tree) {
    console.log(
      `${VENDOR_BRANCH} is already at ${manifest.ref} (${bankSha.slice(0, 8)}) — nothing to sync.`,
    );
    return;
  }

  const commit = git([
    "commit-tree",
    tree,
    ...(parent ? ["-p", parent] : []),
    "-m",
    vendorCommitMessage(bankSha, manifest),
  ]);
  git(["update-ref", VENDOR_REF, commit, ...(parent ? [parent] : [])]);

  console.log(
    [
      `${VENDOR_BRANCH} ${parent ? "updated" : "created"}: ${commit.slice(0, 8)} — bank ${manifest.ref} (${bankSha.slice(0, 8)}), ${manifest.include.length} include path(s).`,
      "",
      "Nothing has been merged. On your working branch, run:",
      "",
      `  git merge${parent ? "" : " --allow-unrelated-histories"} ${VENDOR_BRANCH}`,
      "",
    ].join("\n"),
  );
}

function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter((arg) => arg !== "--check");
  if (unknown.length)
    return fail(
      `unknown argument${unknown.length === 1 ? "" : "s"} ${unknown.join(" ")} — usage: bank:sync [--check]`,
    );

  const root = enterRepoRoot();
  const manifest = readManifest(root);
  if (args.includes("--check")) runCheck(root, manifest);
  else runSync(root, manifest);
}

try {
  main();
} catch (error) {
  // Nothing is written before the final `update-ref`, so aborting here always
  // leaves the vendor branch exactly as it was.
  if (!(error instanceof BankError)) throw error;
  console.error(`bank:sync: ${error.message}`);
  process.exit(EXIT_ERROR);
}
