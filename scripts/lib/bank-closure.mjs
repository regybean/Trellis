// @ts-check
/**
 * Resolve a consumer's selection to the paths it takes from the bank.
 *
 * A manifest names **packages and bundles**, never paths
 * ([ADR 0039](../../docs/adr/0039-the-selection-is-the-contract.md)). This file
 * turns that selection into the flat prefix list `bank:sync` filters the bank
 * tree down to, reading everything out of the bank commit itself:
 * `pnpm-workspace.yaml` for the globs that define the package set, every
 * `package.json` under them for the names and the dependency edges, and
 * `bank.paths.json` for the bundles and the exclusions.
 *
 * Resolving at the pinned ref rather than at authoring time is the whole point:
 * a package that gains a dependency, moves directory or is renamed upstream
 * changes what the consumer takes without anyone editing a list. It also means
 * the resolution has to run on git plumbing alone — no install, no pnpm, no
 * turbo — because the bank being resolved is a fetched tree, not a checkout.
 */
import { fail, git, gitOrNull, under } from "./bank.mjs";

/** The bank's own inventory: the bundles and the exclusions, at the bank ref. */
const PATHS_FILE = "bank.paths.json";
const WORKSPACE_FILE = "pnpm-workspace.yaml";

/** Dependency fields that make one workspace package need another. */
const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

/**
 * A file's contents at a bank commit — `undefined` when the path is absent.
 *
 * @param {string} sha
 * @param {string} path
 * @returns {string | undefined}
 */
const blob = (sha, path) =>
  gitOrNull(["cat-file", "-p", `${sha}:${path}`], {
    maxBuffer: 16 * 1024 * 1024,
  });

/**
 * @param {string} sha
 * @param {string} path
 * @returns {Record<string, unknown>}
 */
function readJson(sha, path) {
  const raw =
    blob(sha, path) ??
    fail(`${path} is not present at the bank ref ${sha.slice(0, 8)}`);
  try {
    return JSON.parse(raw);
  } catch (error) {
    return fail(
      `${path} at bank ${sha.slice(0, 8)} is not valid JSON: ${String(error)}`,
    );
  }
}

/**
 * The workspace globs a `pnpm-workspace.yaml` declares — the definition of the
 * bank's package set.
 *
 * The `packages:` key is a flat sequence of glob strings, so a line scanner
 * reads it without a YAML dependency: the bank scripts run on plain node in a
 * consumer repo that has installed nothing yet.
 *
 * @param {string} raw Contents of a `pnpm-workspace.yaml`.
 * @param {string} what What to call the file when it is rejected.
 * @returns {string[]}
 */
export function parseWorkspaceGlobs(raw, what = WORKSPACE_FILE) {
  const lines = raw.split("\n");
  const start = lines.findIndex((line) => /^packages:\s*$/.test(line));
  if (start === -1) return fail(`${what} has no "packages:" key`);

  /** @type {string[]} */
  const globs = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\s*(#.*)?$/.test(line)) continue; // blank line or comment
    const item = line.match(/^\s+-\s+(.+?)\s*$/);
    if (!item) break; // the next top-level key ends the sequence
    globs.push(item[1].replace(/^["']|["']$/g, ""));
  }

  if (globs.length === 0) return fail(`${what} lists no workspace globs`);
  return globs;
}

/**
 * @param {string} sha
 * @returns {string[]}
 */
function workspaceGlobs(sha) {
  const raw =
    blob(sha, WORKSPACE_FILE) ??
    fail(
      `${WORKSPACE_FILE} is not present at the bank ref ${sha.slice(0, 8)} — the bank's package set is derived from it`,
    );
  return parseWorkspaceGlobs(
    raw,
    `${WORKSPACE_FILE} at bank ${sha.slice(0, 8)}`,
  );
}

/**
 * One workspace glob as an anchored regexp over directory paths. Only `*` is
 * meaningful in a pnpm workspace glob at the depths this repo uses, and it never
 * crosses a path separator.
 *
 * @param {string} glob
 * @returns {RegExp}
 */
const globToRegExp = (glob) =>
  new RegExp(
    `^${glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]+")}$`,
  );

/**
 * @typedef {object} BankPackage
 * @property {string} name
 * @property {string} path Repo-relative package directory.
 * @property {string[]} deps Every declared dependency name, workspace or not.
 * @property {boolean} infra Whether the package declares `acme.infra`.
 */

/**
 * Every package the bank offers at `sha`, indexed by name.
 *
 * The set is the workspace globs minus anything under `exclude` — which is how
 * `apps/*` stays out without this file naming it. A package with no `name` is
 * not selectable, so it is skipped rather than treated as an error.
 *
 * @param {string} sha
 * @param {string[]} exclude
 * @returns {Map<string, BankPackage>}
 */
function packageIndex(sha, exclude) {
  const globs = workspaceGlobs(sha).map(globToRegExp);
  const dirs = git(["ls-tree", "-r", "--name-only", "-z", sha], {
    maxBuffer: 256 * 1024 * 1024,
  })
    .split("\0")
    .filter((path) => path.endsWith("/package.json"))
    .map((path) => path.slice(0, -"/package.json".length))
    .filter((dir) => globs.some((glob) => glob.test(dir)))
    .filter((dir) => !exclude.some((prefix) => under(dir, prefix)));

  /** @type {Map<string, BankPackage>} */
  const index = new Map();
  for (const dir of dirs) {
    const pkg = readJson(sha, `${dir}/package.json`);
    if (typeof pkg.name !== "string" || pkg.name === "") continue;
    const deps = DEPENDENCY_FIELDS.flatMap((field) => {
      const value = pkg[field];
      return value && typeof value === "object" ? Object.keys(value) : [];
    });
    const acme = /** @type {{ infra?: unknown } | undefined} */ (
      pkg.acme && typeof pkg.acme === "object" ? pkg.acme : undefined
    );
    index.set(pkg.name, {
      name: pkg.name,
      path: dir,
      deps,
      infra: Array.isArray(acme?.infra) && acme.infra.length > 0,
    });
  }
  return index;
}

/**
 * The transitive workspace closure of `names`. A dependency outside the index is
 * an ordinary npm dependency and stops the walk; only workspace edges are
 * followed, because only workspace packages are paths in the bank.
 *
 * @param {Map<string, BankPackage>} index
 * @param {string[]} names
 * @returns {BankPackage[]}
 */
function closure(index, names) {
  /** @type {Map<string, BankPackage>} */
  const reached = new Map();
  const queue = [...names];
  while (queue.length) {
    const name = /** @type {string} */ (queue.pop());
    if (reached.has(name)) continue;
    const pkg = index.get(name);
    if (!pkg) continue;
    reached.set(name, pkg);
    for (const dep of pkg.deps) if (index.has(dep)) queue.push(dep);
  }
  return [...reached.values()];
}

/**
 * @typedef {object} Bundle
 * @property {string} name
 * @property {boolean} alwaysIncluded
 * @property {string[]} paths
 */

/**
 * @param {string} sha
 * @returns {{ bundles: Bundle[], exclude: string[] }}
 */
function readBankPaths(sha) {
  const parsed = readJson(sha, PATHS_FILE);
  const list = (/** @type {string} */ field) => {
    const value = parsed[field];
    if (!Array.isArray(value))
      return fail(
        `${PATHS_FILE} at bank ${sha.slice(0, 8)}: "${field}" must be an array`,
      );
    return value;
  };

  return {
    bundles: list("bundles").map((entry) => ({
      name: String(entry.name),
      alwaysIncluded: entry.alwaysIncluded === true,
      paths: Array.isArray(entry.paths) ? entry.paths.map(String) : [],
    })),
    exclude: list("exclude").map((entry) => String(entry.path)),
  };
}

/**
 * Split selected bundle names into the ones worth recording and the ones that
 * were never a choice — for whatever authors a manifest.
 *
 * A bundle the bank marks `alwaysIncluded` arrives whether or not the manifest
 * names it, so recording it is noise that reads like an opt-in — and would read
 * like an opt-*out* were it ever removed. Selecting one is not an error, since
 * asking for what you were getting anyway is a reasonable thing to type; it is
 * dropped, and the caller says so. The flag is read off the bank at `sha`, which
 * is why this lives here and why nothing hardcodes `root`.
 *
 * Unknown names are left in both lists' input for `resolveInclude` to reject, so
 * the "no such bundle" message stays in one place.
 *
 * @param {string} sha
 * @param {string[]} selected
 * @returns {{ bundles: string[], dropped: string[] }}
 */
export function chosenBundles(sha, selected) {
  const always = readBankPaths(sha)
    .bundles.filter((bundle) => bundle.alwaysIncluded)
    .map((bundle) => bundle.name);

  return {
    bundles: selected.filter((name) => !always.includes(name)),
    dropped: selected.filter((name) => always.includes(name)),
  };
}

/**
 * The paths behind the selected bundles, plus the ones no selection can opt out
 * of, plus `infra` when the closure asks for it.
 *
 * @param {Bundle[]} bundles
 * @param {string[]} selected
 * @param {boolean} infra `true` when a closure member declares `acme.infra`.
 * @returns {string[]}
 */
function bundlePaths(bundles, selected, infra) {
  const unknown = selected.filter(
    (name) => !bundles.some((bundle) => bundle.name === name),
  );
  if (unknown.length)
    return fail(
      `no such bundle${unknown.length === 1 ? "" : "s"} ${unknown.join(", ")} — the bank offers ${bundles.map((bundle) => bundle.name).join(", ")}`,
    );

  return bundles
    .filter(
      (bundle) =>
        bundle.alwaysIncluded ||
        selected.includes(bundle.name) ||
        (infra && bundle.name === "infra"),
    )
    .flatMap((bundle) => bundle.paths);
}

/**
 * @typedef {object} Selection
 * @property {string[]} packages Workspace package names.
 * @property {string[]} bundles Bundle names.
 * @property {string[]} omit Closure paths the consumer supplies itself.
 */

/**
 * @typedef {object} Resolved
 * @property {string[]} include Sorted prefixes the vendor tree is filtered to.
 * @property {string[]} missing Selected names that do not exist at this ref.
 * @property {string[]} warnings Messages for the human, phrased for them.
 */

/**
 * Resolve a selection to an `include` at one bank commit.
 *
 * A selected name that does not resolve is a hard error under `strict`, because
 * silently dropping a package the consumer imports turns a manifest problem into
 * a build error three steps later. `--check` resolves non-strictly instead, so
 * it can *report* that a bump would break rather than refusing to look.
 *
 * @param {string} sha
 * @param {Selection} selection
 * @param {{ strict?: boolean }} [options]
 * @returns {Resolved}
 */
export function resolveInclude(sha, selection, { strict = true } = {}) {
  const { bundles, exclude } = readBankPaths(sha);
  const index = packageIndex(sha, exclude);

  const missing = selection.packages.filter((name) => !index.has(name));
  if (missing.length && strict)
    fail(
      `${missing.length === 1 ? "package" : "packages"} ${missing.join(", ")} named in "packages" ${missing.length === 1 ? "does" : "do"} not exist at the bank ref ${sha.slice(0, 8)} — nothing has been written`,
    );

  const reached = closure(
    index,
    selection.packages.filter((name) => index.has(name)),
  );
  const infra = reached.some((pkg) => pkg.infra);

  const paths = new Set([
    ...reached.map((pkg) => pkg.path),
    ...bundlePaths(bundles, selection.bundles, infra),
  ]);

  /** @type {string[]} */
  const warnings = [];
  for (const entry of selection.omit) {
    const dropped = [...paths].filter((path) => under(path, entry));
    for (const path of dropped) paths.delete(path);
    warnings.push(
      dropped.length
        ? `"omit" drops ${dropped.join(", ")} from the closure — the resulting tree will not install unaided, so supply ${dropped.length === 1 ? "it" : "them"} yourself`
        : `"omit" entry ${entry} is not in the resolved closure, so it drops nothing`,
    );
  }

  return { include: [...paths].sort(), missing, warnings };
}
