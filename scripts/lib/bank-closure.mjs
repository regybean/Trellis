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
 * @property {string} layer The workspace glob's directory — `packages/shared`,
 *   `tooling`. The layer a package sits in is where the bank puts it, so this is
 *   read off the glob that matched rather than mapped from a list here.
 * @property {number} layerRank That glob's position in `pnpm-workspace.yaml`,
 *   which is the order the layers are offered in.
 */

/**
 * The directory a workspace glob covers — `packages/shared/*` is
 * `packages/shared`. A glob with no `*` is its own directory.
 *
 * @param {string} glob
 * @returns {string}
 */
const globDir = (glob) => glob.replace(/\/[^/]*\*.*$/, "");

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
  const globs = workspaceGlobs(sha);
  const matchers = globs.map(globToRegExp);
  const dirs = git(["ls-tree", "-r", "--name-only", "-z", sha], {
    maxBuffer: 256 * 1024 * 1024,
  })
    .split("\0")
    .filter((path) => path.endsWith("/package.json"))
    .map((path) => path.slice(0, -"/package.json".length))
    .map((dir) => ({ dir, rank: matchers.findIndex((glob) => glob.test(dir)) }))
    .filter(({ rank }) => rank !== -1)
    .filter(({ dir }) => !exclude.some((prefix) => under(dir, prefix)));

  /** @type {Map<string, BankPackage>} */
  const index = new Map();
  for (const { dir, rank } of dirs) {
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
      layer: globDir(globs[rank]),
      layerRank: rank,
    });
  }
  return index;
}

/**
 * The transitive workspace closure of `names`, each member carrying the selected
 * packages that reached it. A dependency outside the index is an ordinary npm
 * dependency and stops the walk; only workspace edges are followed, because only
 * workspace packages are paths in the bank.
 *
 * The walk restarts per selected package rather than running once over all of
 * them, because "who dragged this in" is the question the picker's preview
 * answers, and a single shared visited-set cannot answer it: whichever root
 * happened to reach a package first would be the only one credited.
 *
 * @param {Map<string, BankPackage>} index
 * @param {string[]} names
 * @returns {Map<string, { pkg: BankPackage, reasons: Set<string> }>}
 */
function closureWithReasons(index, names) {
  /** @type {Map<string, { pkg: BankPackage, reasons: Set<string> }>} */
  const reached = new Map();
  for (const root of names) {
    const seen = new Set();
    const queue = [root];
    while (queue.length) {
      const name = /** @type {string} */ (queue.pop());
      if (seen.has(name)) continue;
      seen.add(name);
      const pkg = index.get(name);
      if (!pkg) continue;
      const entry = reached.get(name) ?? { pkg, reasons: new Set() };
      if (name !== root) entry.reasons.add(root);
      reached.set(name, entry);
      for (const dep of pkg.deps) if (index.has(dep)) queue.push(dep);
    }
  }
  return reached;
}

/**
 * The same closure, flattened — for the callers that only need the members.
 *
 * @param {Map<string, BankPackage>} index
 * @param {string[]} names
 * @returns {BankPackage[]}
 */
const closure = (index, names) =>
  [...closureWithReasons(index, names).values()].map((entry) => entry.pkg);

/**
 * @typedef {object} Bundle
 * @property {string} name
 * @property {string} description What the bank says the bundle is for.
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
      description:
        typeof entry.description === "string" ? entry.description : "",
      alwaysIncluded: entry.alwaysIncluded === true,
      paths: Array.isArray(entry.paths) ? entry.paths.map(String) : [],
    })),
    exclude: list("exclude").map((entry) => String(entry.path)),
  };
}

/**
 * @typedef {object} OfferBundle
 * @property {string} name
 * @property {string} description
 * @property {boolean} alwaysIncluded Arrives whether or not it is chosen.
 */

/**
 * @typedef {object} OfferLayer
 * @property {string} layer
 * @property {BankPackage[]} packages Sorted by name.
 */

/**
 * @typedef {object} Offer
 * @property {OfferLayer[]} layers Every selectable package, grouped and ordered
 *   the way `pnpm-workspace.yaml` groups and orders them.
 * @property {OfferBundle[]} bundles
 */

/**
 * What the bank offers at `sha`: every package a selection may name, grouped by
 * layer, and every bundle with the flag saying whether choosing it means
 * anything.
 *
 * This is the one derivation the picker, `--list` and the manifest write all
 * read, and it is derived at the ref from the same index `resolveInclude`
 * builds — so a package added, moved or renamed upstream changes the menu with
 * no list here to edit. Which is also why `alwaysIncluded` is read through this
 * rather than through a second entry point beside it: whatever authors a
 * manifest needs the flag to know that naming `root` records a choice nobody
 * made, and it already has the offer in hand.
 *
 * @param {string} sha
 * @returns {Offer}
 */
export function bankOffer(sha) {
  const { bundles, exclude } = readBankPaths(sha);
  const index = packageIndex(sha, exclude);

  /** @type {Map<string, { layer: string, rank: number, packages: BankPackage[] }>} */
  const layers = new Map();
  for (const pkg of index.values()) {
    const layer = layers.get(pkg.layer) ?? {
      layer: pkg.layer,
      rank: pkg.layerRank,
      packages: [],
    };
    layer.packages.push(pkg);
    layers.set(pkg.layer, layer);
  }

  return {
    layers: [...layers.values()]
      .sort((a, b) => a.rank - b.rank || a.layer.localeCompare(b.layer))
      .map(({ layer, packages }) => ({
        layer,
        packages: packages.sort((a, b) => a.name.localeCompare(b.name)),
      })),
    bundles: bundles.map(({ name, description, alwaysIncluded }) => ({
      name,
      description,
      alwaysIncluded,
    })),
  };
}

/**
 * @typedef {object} PulledPackage
 * @property {string} name
 * @property {string} path
 * @property {string} layer
 * @property {string[]} reasons The selected packages that required it, sorted.
 */

/**
 * @typedef {object} Preview
 * @property {PulledPackage[]} pulled What the selection drags in behind it —
 *   the closure minus the packages that were chosen outright.
 * @property {boolean} infra Whether the closure declares `acme.infra`, which is
 *   what selects the `infra` bundle without anyone asking for it.
 */

/**
 * What a selection pulls in, and which choice pulled each one.
 *
 * Pure over an `Offer` rather than reading the ref itself: the picker calls this
 * on every keystroke, and re-reading forty `package.json` blobs out of git per
 * toggle would make the menu feel broken. The offer already carries the
 * dependency edges, so this is a walk over memory.
 *
 * A name the offer does not know is ignored rather than rejected — this renders
 * a menu, and `resolveInclude` is where a selection is held to existing.
 *
 * @param {Offer} offer
 * @param {string[]} packages Selected package names.
 * @returns {Preview}
 */
export function closurePreview(offer, packages) {
  const index = new Map(
    offer.layers.flatMap(({ packages: members }) =>
      members.map((pkg) => [pkg.name, pkg]),
    ),
  );
  const selected = packages.filter((name) => index.has(name));
  const reached = closureWithReasons(index, selected);
  const chosen = new Set(selected);

  return {
    pulled: [...reached.values()]
      .filter(({ pkg }) => !chosen.has(pkg.name))
      .map(({ pkg, reasons }) => ({
        name: pkg.name,
        path: pkg.path,
        layer: pkg.layer,
        reasons: [...reasons].sort(),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    infra: [...reached.values()].some(({ pkg }) => pkg.infra),
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
