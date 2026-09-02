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
 * Usage:
 *   node scripts/bank-sync.mjs   # or: pnpm bank:sync
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

/**
 * Abort with a message on stderr. Nothing is written before the final
 * `update-ref`, so failing here always leaves the vendor branch as it was.
 *
 * @param {string} message
 * @returns {never}
 */
function fail(message) {
  console.error(`bank:sync: ${message}`);
  process.exit(1);
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
 * @returns {string}
 */
function buildFilteredTree(root, sha, include) {
  const under = (/** @type {string} */ path, /** @type {string} */ entry) =>
    path === entry || path.startsWith(`${entry}/`);

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

function main() {
  const root = gitOrNull(["rev-parse", "--show-toplevel"]);
  if (!root) return fail("not inside a git repository");
  process.chdir(root);

  const manifest = readManifest(root);
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

main();
