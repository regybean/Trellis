// @ts-check
/**
 * Shared machinery for the bank commands — `bank:sync` (pull) and
 * `bank:contribute` (back-flow). See
 * docs/adr/0037-vendored-git-subset-three-way-merge.md for the model and
 * docs/bank.md for the consumer-facing guide.
 *
 * Both commands read the same `bank.manifest.json`, talk to the same upstream,
 * and agree on the `vendor/trellis` commit format. That agreement is why this
 * file exists rather than each script carrying its own copy: the bank sha
 * `bank:contribute` bases its patch on is the one `bank:sync` recorded.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const MANIFEST = "bank.manifest.json";
export const VENDOR_BRANCH = "vendor/trellis";
export const VENDOR_REF = `refs/heads/${VENDOR_BRANCH}`;

/** Namespace the all-refs fallback fetch lands in, so it shadows nothing local. */
const FETCH_NS = "refs/bank-sync";

/**
 * A message meant for the human, already phrased for them. Every abort path
 * raises one of these; the scripts catch it at the top level and print it under
 * their own name, so no helper needs to know which command it is running under.
 */
export class BankError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "BankError";
  }
}

/**
 * Abort with a message for the human. Typed `never` so it can stand in
 * expression position (`return fail(...)`, `?? fail(...)`) at a call site that
 * owes a value.
 *
 * @param {string} message
 * @returns {never}
 */
export function fail(message) {
  throw new BankError(message);
}

/**
 * Run git, returning trimmed stdout. Throws on a non-zero exit.
 *
 * @param {string[]} args
 * @param {import("node:child_process").ExecFileSyncOptions & { input?: string }} [options]
 * @returns {string}
 */
export function git(args, options = {}) {
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
export function gitOrNull(args, options = {}) {
  try {
    return git(args, options);
  } catch {
    return undefined;
  }
}

/**
 * Is `path` the prefix itself, or inside it? A resolved `include`, and the
 * manifest's `omit` and `contributable`, are all prefix lists, so this is the
 * only containment test either command makes.
 *
 * @param {string} path
 * @param {string} prefix
 */
export const under = (path, prefix) =>
  path === prefix || path.startsWith(`${prefix}/`);

/**
 * Normalise one repo-relative path from the manifest or the command line,
 * rejecting anything that could reach outside the repo.
 *
 * @param {string} entry
 * @param {string} what What to call the offending value when it is rejected.
 * @returns {string}
 */
export function repoRelative(entry, what) {
  const path = entry.trim().replace(/^\.\//, "").replace(/\/+$/, "");
  if (path === "" || path.startsWith("/") || path.split("/").includes(".."))
    return fail(`${what} ${JSON.stringify(entry)} is not a repo-relative path`);
  return path;
}

/**
 * @typedef {object} Manifest
 * @property {string} upstream Git URL of the bank.
 * @property {string} ref Branch, tag or sha in the bank to sync from.
 * @property {string[]} packages Workspace package names taken from the bank.
 * @property {string[]} bundles Bundle names taken from the bank.
 * @property {string[]} omit Closure paths the consumer supplies itself.
 * @property {string[]} contributable Paths allowed to flow back upstream.
 *
 * A manifest records a **selection**, never paths: `bank:sync` resolves it to
 * the paths at the pinned ref (ADR 0039). `include` is not a field.
 */

/**
 * Read and validate the manifest. Every field is checked here rather than at
 * point of use, so a malformed manifest fails before anything is fetched.
 *
 * @param {string} root
 * @returns {Manifest}
 */
export function readManifest(root) {
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
   * @returns {string[]}
   */
  const strings = (field) => {
    const value = parsed[field] ?? [];
    if (
      !Array.isArray(value) ||
      value.some((entry) => typeof entry !== "string")
    )
      return fail(`${MANIFEST}: "${field}" must be an array of strings`);
    return value;
  };

  // A manifest that still authors paths is a pre-ADR-0039 one. Naming the
  // replacement beats resolving an empty selection and syncing almost nothing.
  if ("include" in parsed)
    return fail(
      `${MANIFEST}: "include" is no longer authored — name what you take in "packages" (e.g. "@acme/ui") and "bundles", and bank:sync resolves the paths at "ref". See docs/bank.md.`,
    );

  return {
    upstream: str("upstream"),
    ref: str("ref"),
    packages: strings("packages"),
    bundles: strings("bundles"),
    omit: strings("omit").map((entry) =>
      repoRelative(entry, `${MANIFEST}: "omit" entry`),
    ),
    contributable: strings("contributable").map((entry) =>
      repoRelative(entry, `${MANIFEST}: "contributable" entry`),
    ),
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
export function fetchBank(upstream, ref) {
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
export function defaultBranch(upstream) {
  const symref = gitOrNull(["ls-remote", "--symref", upstream, "HEAD"]);
  const match = symref?.match(/^ref: refs\/heads\/(\S+)\s+HEAD$/m);
  return match ? match[1] : "HEAD";
}

/**
 * The `vendor/trellis` commit message. It is the only record of which bank
 * commit a vendor commit holds, and `bank:contribute` reads it back out to base
 * its patch on that exact commit — so the two halves have to agree on the
 * format, and this is where they do.
 *
 * It records the selection as well as the paths it resolved to, so a vendor
 * commit says both what was asked for and what arrived — which is the pair you
 * want when a closure changed shape between two syncs.
 *
 * @param {string} bankSha
 * @param {Manifest} manifest
 * @param {string[]} include The paths `manifest`'s selection resolved to.
 * @returns {string}
 */
export function vendorCommitMessage(bankSha, manifest, include) {
  /**
   * @param {string} label
   * @param {string[]} entries
   */
  const section = (label, entries) =>
    entries.length ? [`${label}:`, ...entries.map((e) => `  - ${e}`)] : [];

  return [
    `vendor: bank@${bankSha.slice(0, 8)}`,
    "",
    `upstream: ${manifest.upstream}`,
    `ref: ${manifest.ref}`,
    `commit: ${bankSha}`,
    ...section("packages", manifest.packages),
    ...section("bundles", manifest.bundles),
    ...section("omit", manifest.omit),
    ...section("include", include),
  ].join("\n");
}

/**
 * The bank commit a vendor commit holds, read back out of its message.
 * `undefined` when the commit was not written by `bank:sync`.
 *
 * @param {string} commit A vendor commit-ish.
 * @returns {string | undefined}
 */
export function vendorBankSha(commit) {
  const message = gitOrNull(["log", "-1", "--format=%B", commit]);
  return message?.match(/^commit: ([0-9a-f]{40})$/m)?.[1];
}

/**
 * `owner/name` for a GitHub remote, or `undefined` for anything else — a
 * mirror, a local path, or a bank hosted elsewhere. The caller decides what to
 * do without one; nothing here assumes the bank is on GitHub.
 *
 * @param {string} upstream
 * @returns {string | undefined}
 */
export function githubSlug(upstream) {
  const match = upstream.match(
    /^(?:https?:\/\/|git@|ssh:\/\/git@)github\.com[/:]([^/]+)\/(.+?)(?:\.git)?\/?$/,
  );
  return match ? `${match[1]}/${match[2]}` : undefined;
}

/**
 * The repo root, with the process moved into it so every relative path below
 * means the same thing.
 *
 * @returns {string}
 */
export function enterRepoRoot() {
  const root = gitOrNull(["rev-parse", "--show-toplevel"]);
  if (!root) return fail("not inside a git repository");
  process.chdir(root);
  return root;
}
