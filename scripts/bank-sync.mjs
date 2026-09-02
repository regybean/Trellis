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
 * Usage:
 *   node scripts/bank-sync.mjs             # or: pnpm bank:sync
 *   node scripts/bank-sync.mjs --check     # or: pnpm bank:sync --check
 *
 * Exit codes (`--check`):
 *   0  up to date — nothing unpulled
 *   1  error — bad manifest, unreachable bank, unresolvable ref
 *   2  behind — the bank has commits this repo has not taken
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MANIFEST = "bank.manifest.json";
const VENDOR_BRANCH = "vendor/trellis";
const VENDOR_REF = `refs/heads/${VENDOR_BRANCH}`;
/** Namespace the all-refs fallback fetch lands in, so it shadows nothing local. */
const FETCH_NS = "refs/bank-sync";

/** `--check` outcomes. Documented in docs/bank.md, so any CI can gate on them. */
const EXIT_UP_TO_DATE = 0;
const EXIT_ERROR = 1;
const EXIT_BEHIND = 2;

/**
 * Abort with a message on stderr. Nothing is written before the final
 * `update-ref`, so failing here always leaves the vendor branch as it was.
 *
 * @param {string} message
 * @returns {never}
 */
function fail(message) {
  console.error(`bank:sync: ${message}`);
  process.exit(EXIT_ERROR);
}

/**
 * Run git, returning trimmed stdout. Throws on a non-zero exit.
 *
 * @param {string[]} args
 * @param {import("node:child_process").ExecFileSyncOptions & { input?: string }} [options]
 * @returns {string}
 */
function git(args, options = {}) {
  return String(
    execFileSync("git", args, {
      stdio: ["pipe", "pipe", "pipe"],
      ...options,
      encoding: "utf8",
    }),
  ).trim();
}

/**
 * Run git for its exit code alone — `undefined` when it fails.
 *
 * @param {string[]} args
 * @param {import("node:child_process").ExecFileSyncOptions & { input?: string }} [options]
 * @returns {string | undefined}
 */
function gitOrNull(args, options = {}) {
  try {
    return git(args, options);
  } catch {
    return undefined;
  }
}

/**
 * @typedef {object} Manifest
 * @property {string} upstream Git URL of the bank.
 * @property {string} ref Branch, tag or sha in the bank to sync from.
 * @property {string[]} include Repo-relative paths taken from the bank.
 * @property {string[]} contributable Paths allowed to flow back upstream.
 */

/**
 * Read and validate the manifest. Every field is checked here rather than at
 * point of use, so a malformed manifest fails before anything is fetched.
 *
 * @param {string} root
 * @returns {Manifest}
 */
function readManifest(root) {
  const path = join(root, MANIFEST);
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return fail(
      `no ${MANIFEST} at ${root} — a consumer repo pins its bank there.`,
    );
  }

  /** @type {Record<string, unknown>} */
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return fail(`${MANIFEST} is not valid JSON: ${String(error)}`);
  }

  /** @param {string} field */
  const str = (field) => {
    const value = parsed[field];
    if (typeof value !== "string" || value.trim() === "")
      return fail(`${MANIFEST}: "${field}" must be a non-empty string`);
    return value.trim();
  };

  /**
   * @param {string} field
   * @param {{ allowEmpty: boolean }} options
   * @returns {string[]}
   */
  const strings = (field, { allowEmpty }) => {
    const value = parsed[field] ?? [];
    if (
      !Array.isArray(value) ||
      value.some((entry) => typeof entry !== "string")
    )
      return fail(`${MANIFEST}: "${field}" must be an array of strings`);
    if (!allowEmpty && value.length === 0)
      return fail(`${MANIFEST}: "${field}" must list at least one path`);
    return value;
  };

  const include = strings("include", { allowEmpty: false }).map((entry) => {
    const path = entry.replace(/^\.\//, "").replace(/\/+$/, "");
    if (path === "" || path.startsWith("/") || path.split("/").includes(".."))
      return fail(
        `${MANIFEST}: "include" entry ${JSON.stringify(entry)} is not a repo-relative path`,
      );
    return path;
  });

  return {
    upstream: str("upstream"),
    ref: str("ref"),
    include,
    contributable: strings("contributable", { allowEmpty: true }),
  };
}

/**
 * Fetch the bank and resolve `ref` to a commit sha.
 *
 * The direct refspec covers branches and tags, which is what a manifest pins in
 * practice. A raw sha is only fetchable that way when the server allows
 * reachable-sha1-in-want, so fall back to fetching every ref into our own
 * namespace and resolving locally.
 *
 * @param {string} upstream
 * @param {string} ref
 * @returns {string}
 */
function fetchBank(upstream, ref) {
  if (
    gitOrNull(["fetch", "--no-tags", "--quiet", upstream, ref]) !== undefined
  ) {
    const sha = gitOrNull([
      "rev-parse",
      "--verify",
      "--quiet",
      "FETCH_HEAD^{commit}",
    ]);
    if (sha) return sha;
  }

  gitOrNull([
    "fetch",
    "--quiet",
    "--force",
    upstream,
    `+refs/heads/*:${FETCH_NS}/heads/*`,
    `+refs/tags/*:${FETCH_NS}/tags/*`,
  ]);

  for (const candidate of [
    `${FETCH_NS}/heads/${ref}`,
    `${FETCH_NS}/tags/${ref}`,
    ref,
  ]) {
    const sha = gitOrNull([
      "rev-parse",
      "--verify",
      "--quiet",
      `${candidate}^{commit}`,
    ]);
    if (sha) return sha;
  }

  return fail(
    `cannot resolve ref "${ref}" at ${upstream} — check the "ref" in ${MANIFEST}`,
  );
}

/**
 * The bank's canonical branch. ADR 0037 makes that whatever `HEAD` points at
 * upstream rather than a name hardcoded here. `HEAD` is itself a fetchable ref,
 * so it is a safe fallback when the server sends no symref.
 *
 * @param {string} upstream
 * @returns {string}
 */
function defaultBranch(upstream) {
  const symref = gitOrNull(["ls-remote", "--symref", upstream, "HEAD"]);
  const match = symref?.match(/^ref: refs\/heads\/(\S+)\s+HEAD$/m);
  return match ? match[1] : "HEAD";
}

/**
 * @param {string} path
 * @param {string} prefix
 */
const under = (path, prefix) =>
  path === prefix || path.startsWith(`${prefix}/`);

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
 * @param {Manifest} manifest
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
 * @param {Manifest} manifest
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

  const message = [
    `vendor: bank@${bankSha.slice(0, 8)}`,
    "",
    `upstream: ${manifest.upstream}`,
    `ref: ${manifest.ref}`,
    `commit: ${bankSha}`,
    "include:",
    ...manifest.include.map((entry) => `  - ${entry}`),
  ].join("\n");

  const commit = git([
    "commit-tree",
    tree,
    ...(parent ? ["-p", parent] : []),
    "-m",
    message,
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

  const root = gitOrNull(["rev-parse", "--show-toplevel"]);
  if (!root) return fail("not inside a git repository");
  process.chdir(root);

  const manifest = readManifest(root);
  if (args.includes("--check")) runCheck(root, manifest);
  else runSync(root, manifest);
}

main();
