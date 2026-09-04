#!/usr/bin/env tsx
/**
 * Test inventory — a markdown list of every test the suite collects.
 *
 * The test names in this repo read as behaviour, but they are only visible in a
 * passing run's scrollback, which makes auditing them impossible. This prints
 * them all, grouped and counted, without running a single one.
 *
 * The data source is `vitest list --json`, run once per package vitest config.
 * That matters: it honours each package's real `include` and resolves computed
 * names (`it.each`), so the output is what actually runs rather than what a
 * filesystem glob guesses. Nothing here parses a test file. Note the corollary:
 * `vitest list` reports only what would run, so a `.skip` or `.todo` appears
 * nowhere in the inventory.
 *
 * `vitest list` normally runs `globalSetup`, which for a backend suite means
 * starting testcontainers and pushing a schema purely to print names. So this
 * sets `VITEST_LIST_ONLY`, which `backendProject` reads to omit `globalSetup`
 * (tooling/test-utils/src/vitest.ts) — collection needs no infra, and every
 * reachable `env.ts` still validates against `staticTestEnv`. Listing is
 * therefore seconds, and needs no container runtime at all.
 *
 * A target narrows what is collected. A package name lists just that package.
 * An **app** name expands to the app's full transitive workspace closure,
 * tooling included, so the answer is what that deployable's suite actually
 * covers — platform packages are where low-value tests hide, and `@acme/redis`'s
 * durable-stream tests are load-bearing for chat, so nothing is trimmed. The
 * difference between a full app's inventory and a slim one's is then the
 * repo's subsetting claim, observable rather than asserted.
 *
 * Token resolution and the closure query are shared with
 * `scripts/resolve-infra.ts` (scripts/lib/workspace-targets.ts), so `nextjs`
 * means the same app here as it does to `pnpm dev`.
 *
 * Output is markdown on stdout; progress and errors go to stderr, so the
 * markdown pipes cleanly. Nothing is written to the repo — this is an ad-hoc
 * read, not an artifact, so it stays out of the quality gate.
 *
 * `--layer` and `--kind` narrow the report to the path segments under
 * `src/tests/`; the canonical layout makes that prefix a filter axis rather than
 * a guess. They compose as an intersection, and every heading and count is
 * computed after the narrowing, so a count counts what survived the filter and a
 * package that keeps nothing loses its heading. `--out` writes the report to a
 * file instead of stdout. The group segment stays a heading and never becomes a
 * third flag: three ways to name a test is more than an audit needs.
 *
 * Usage:
 *   pnpm test:inventory                          # every package with tests
 *   pnpm test:inventory @acme/chat               # one package
 *   pnpm test:inventory nextjs-slim              # an app's whole closure
 *   pnpm test:inventory --layer backend --kind unit
 *   pnpm test:inventory --kind unit,integration --out inventory.md
 *
 * Exit codes:
 *   0  inventory printed
 *   1  a package's collection failed (its stderr is reported)
 *   2  bad usage — a bad flag, or a target naming nothing or two things
 */
import { execFile } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { availableParallelism, tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";

import {
  matchToken,
  workspaceApps,
  workspaceClosure,
  type WorkspacePackage,
} from "./lib/workspace-targets";

// `import.meta.dirname` is undefined under tsx's CJS transform; derive it from
// the module URL, which tsx shims.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Rejects on a non-zero exit, with both streams on the error. */
const run = promisify(execFile);

/**
 * The workspace's own vitest, run directly on this node rather than through
 * `pnpm exec`: twenty package-manager startups is real time, and resolving from
 * the root manifest is the same lookup pnpm would do.
 */
const require = createRequire(join(ROOT, "package.json"));
const vitestManifest = require.resolve("vitest/package.json");
const VITEST_BIN = join(
  dirname(vitestManifest),
  (
    JSON.parse(readFileSync(vitestManifest, "utf8")) as {
      bin: { vitest: string };
    }
  ).bin.vitest,
);

/**
 * Workspace layer directories, in dependency order (tooling → platform →
 * shared → features → apps), mirrored from pnpm-workspace.yaml. Reading order
 * follows the direction the graph points, so a package appears after everything
 * it is built on. Packages are alphabetical within a layer.
 */
const LAYERS = [
  { label: "tooling", dir: "tooling" },
  { label: "platform", dir: "packages/platform" },
  { label: "shared", dir: "packages/shared" },
  { label: "features", dir: "packages/features" },
  { label: "apps", dir: "apps" },
];

/** One suite per side, named by convention (docs/agents/testing.md). */
const CONFIGS = ["vitest.config.backend.ts", "vitest.config.frontend.ts"];

interface Suite {
  layer: string;
  name: string;
  dir: string;
  config: string;
}

/** A test as `vitest list --json` reports it. */
interface Entry {
  name: string;
  file: string;
}

/**
 * Every workspace package under a layer directory, with the vitest configs it
 * has. A package with no config has no tests to collect and never reaches the
 * report — but it is still a legitimate target, and still part of a closure.
 */
function findPackages(): (WorkspacePackage & {
  layer: string;
  configs: string[];
})[] {
  const packages = [];
  for (const { label, dir } of LAYERS) {
    const layerDir = join(ROOT, dir);
    if (!existsSync(layerDir)) continue;
    for (const entry of readdirSync(layerDir).sort()) {
      const pkgDir = join(layerDir, entry);
      const manifest = join(pkgDir, "package.json");
      if (!statSync(pkgDir).isDirectory() || !existsSync(manifest)) continue;
      const json = JSON.parse(readFileSync(manifest, "utf8")) as {
        name?: string;
      };
      packages.push({
        layer: label,
        name: json.name ?? `${dir}/${entry}`,
        dir: pkgDir,
        configs: CONFIGS.filter((config) => existsSync(join(pkgDir, config))),
      });
    }
  }
  return packages;
}

/**
 * The (package, vitest config) pairs to collect, narrowed to `names` when the
 * caller gave targets.
 *
 * @param names `undefined` for every package; otherwise the exact set.
 */
function findSuites(
  packages: ReturnType<typeof findPackages>,
  names?: Set<string>,
): Suite[] {
  const suites = packages
    .filter((pkg) => names === undefined || names.has(pkg.name))
    .flatMap(({ layer, name, dir, configs }) =>
      configs.map((config) => ({ layer, name, dir, config })),
    );
  // `readdirSync` sorts by directory name; the heading is the package name, so
  // sort by that instead ("@acme/db" before "@acme/entitlements").
  return suites.sort(
    (a, b) => a.name.localeCompare(b.name) || a.config.localeCompare(b.config),
  );
}

/**
 * The packages a target token stands for: an app expands to its transitive
 * closure, anything else is just itself.
 *
 * Apps are checked first and by the shared matcher, so `nextjs` names the same
 * app `pnpm dev nextjs` starts. A token naming nothing, or naming two things,
 * is a usage error rather than an empty report — silently printing nothing for
 * a typo is the failure worth ruling out.
 */
function expandTargets(
  tokens: string[],
  packages: ReturnType<typeof findPackages>,
): Set<string> {
  const apps = workspaceApps(ROOT);
  const names = new Set<string>();
  const appTargets: string[] = [];

  for (const token of tokens) {
    const app = matchToken(token, apps);
    if (app) {
      appTargets.push(app.name);
      continue;
    }
    const pkg = matchToken(token, packages);
    if (!pkg) {
      throw new Error(`no workspace package or app is named "${token}"`);
    }
    names.add(pkg.name);
  }

  for (const project of workspaceClosure(ROOT, appTargets)) {
    names.add(project.name);
  }
  return names;
}

/**
 * `vitest list` for one suite, as the entries it reported.
 *
 * The JSON goes to a file rather than stdout: a config's own imports are free
 * to log, and mixing that into the stream we parse would make collection
 * fragile for no reason.
 */
async function listSuite(
  suite: Suite,
  scratch: string,
): Promise<{ entries: Entry[]; failure?: string }> {
  const out = join(
    scratch,
    `${suite.name.replaceAll("/", "_")}-${suite.config}.json`,
  );
  try {
    await run(
      process.execPath,
      [VITEST_BIN, "list", "--config", suite.config, `--json=${out}`],
      {
        cwd: suite.dir,
        // The one carve-out that keeps listing cheap. See the header.
        env: { ...process.env, VITEST_LIST_ONLY: "1" },
      },
    );
  } catch (error) {
    // A vitest that cannot collect says why on its own streams; that is the
    // whole report, so hand it back rather than paraphrasing it.
    const { stdout = "", stderr = "" } = (error ?? {}) as {
      stdout?: string;
      stderr?: string;
    };
    return {
      entries: [],
      failure: `${stdout}${stderr}`.trim() || String(error),
    };
  }
  if (!existsSync(out)) {
    return { entries: [], failure: `vitest wrote no list to ${out}` };
  }
  return { entries: JSON.parse(readFileSync(out, "utf8")) as Entry[] };
}

/**
 * Run `fn` over `items`, at most `limit` at a time. Collection is CPU-bound and
 * touches nothing shared, so the suites are independent and the only reason to
 * cap is not to swamp the machine.
 */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

/**
 * The directories a test file sits under, relative to the package's
 * `src/tests/` — `["backend", "integration", "api"]`. That path *is* the
 * taxonomy (layer / kind / group), so it is both the group heading and the
 * filter axes, rather than something re-derived from a table this tool would
 * then have to keep in step.
 *
 * `null` for a test outside `src/tests/`: unconventional but real, and worth
 * seeing in the report even though it sits under no layer and no kind.
 *
 * @param file absolute path, as `vitest list` reports it
 */
function segmentsOf(file: string, pkgDir: string) {
  const rel = relative(join(pkgDir, "src", "tests"), file).replaceAll(sep, "/");
  if (rel.startsWith("../")) return null;
  return rel.split("/").slice(0, -1);
}

/**
 * The group heading for a test file — its `segmentsOf` path, or, for one
 * outside `src/tests/`, its directory relative to the package.
 */
function groupOf(file: string, pkgDir: string) {
  const segments = segmentsOf(file, pkgDir);
  if (segments === null) {
    return relative(pkgDir, dirname(file)).replaceAll(sep, "/");
  }
  return segments.length === 0 ? "." : segments.join("/");
}

/** The narrowing the caller asked for; an unset axis means everything. */
interface Filters {
  layer?: Set<string>;
  kind?: Set<string>;
}

/**
 * Whether a test file is one the caller asked for: its layer segment in
 * `--layer`, its kind segment in `--kind`, each unset meaning everything. A
 * file outside the canonical layout has neither segment, so any explicit filter
 * excludes it — it can't answer the question that was asked.
 */
function matches(file: string, pkgDir: string, filters: Filters) {
  if (filters.layer === undefined && filters.kind === undefined) return true;
  const [layer, kind] = segmentsOf(file, pkgDir) ?? [];
  if (filters.layer !== undefined && !filters.layer.has(layer)) return false;
  if (filters.kind !== undefined && !filters.kind.has(kind)) return false;
  return true;
}

/** `12 tests` / `1 test` — every heading carries its count. */
function count(n: number) {
  return `${n} test${n === 1 ? "" : "s"}`;
}

function render(collected: (Suite & { entries: Entry[] })[]) {
  const lines = ["# Test inventory", ""];
  let total = 0;

  for (const { label } of LAYERS) {
    const packages = new Map<string, Map<string, string[]>>();
    for (const suite of collected) {
      if (suite.layer !== label || suite.entries.length === 0) continue;
      const groups = packages.get(suite.name) ?? new Map<string, string[]>();
      for (const entry of suite.entries) {
        const group = groupOf(entry.file, suite.dir);
        groups.set(group, [...(groups.get(group) ?? []), entry.name]);
      }
      packages.set(suite.name, groups);
    }
    if (packages.size === 0) continue;

    const layerTotal = [...packages.values()]
      .flatMap((groups) => [...groups.values()])
      .reduce((sum, names) => sum + names.length, 0);
    lines.push(`## ${label} (${count(layerTotal)})`, "");
    total += layerTotal;

    for (const [name, groups] of [...packages].sort((a, b) =>
      a[0].localeCompare(b[0]),
    )) {
      const pkgTotal = [...groups.values()].reduce(
        (sum, names) => sum + names.length,
        0,
      );
      lines.push(`### ${name} (${count(pkgTotal)})`, "");
      for (const [group, names] of [...groups].sort((a, b) =>
        a[0].localeCompare(b[0]),
      )) {
        lines.push(`#### ${group} (${count(names.length)})`, "");
        // Verbatim, describe chain and all: whatever `vitest list` reports is
        // what runs, including skips and computed names.
        for (const name of names) lines.push(`- ${name}`);
        lines.push("");
      }
    }
  }

  const packageCount = new Set(
    collected.filter((s) => s.entries.length > 0).map((s) => s.name),
  ).size;
  lines.push(
    "---",
    "",
    `**Total: ${count(total)} in ${packageCount} packages.**`,
    "",
  );
  return lines.join("\n");
}

const USAGE =
  "Usage: pnpm test:inventory [package|app ...] [--layer <names>] [--kind <names>] [--out <path>]";

/**
 * The targets and flags, off `node:util`'s `parseArgs` — `--flag=value`, a
 * repeated flag and rejecting one nobody declared are all its behaviour, and it
 * is stdlib. Its errors are `TypeError`s aimed at the caller, so they are
 * re-raised as the same phrased-for-a-human refusal as before. Positionals are
 * the package/app targets, left for `expandTargets` to resolve.
 */
function parseFlags() {
  // `pnpm test:inventory nextjs-slim -- --kind unit` forwards the separator
  // too, and parseArgs reads a bare `--` as "everything after this is
  // positional" — which would turn the flags into targets. No target and no
  // flag value is ever `--`, so drop every one of them.
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  try {
    return parseArgs({
      args,
      allowPositionals: true,
      options: {
        layer: { type: "string", multiple: true },
        kind: { type: "string", multiple: true },
        out: { type: "string" },
      },
    });
  } catch (error) {
    console.error(
      `test-inventory: ${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`,
    );
    process.exit(2);
  }
}

/**
 * One axis's selection. `a,b` and a repeated flag both mean the same set, so a
 * generated invocation can build it up either way; unset means everything.
 */
function selection(values: string[] | undefined) {
  const names = (values ?? []).flatMap((value) => value.split(","));
  return names.length === 0 ? undefined : new Set(names);
}

/**
 * tsx transforms this to CJS (the root manifest is not `"type": "module"`), so
 * the entry is a function rather than top-level await.
 */
async function main() {
  const { values: flags, positionals: tokens } = parseFlags();
  const filters: Filters = {
    layer: selection(flags.layer),
    kind: selection(flags.kind),
  };
  const packages = findPackages();

  let targets: Set<string> | undefined;
  try {
    targets = tokens.length > 0 ? expandTargets(tokens, packages) : undefined;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`test-inventory: ${reason}\n\n${USAGE}`);
    process.exit(2);
  }

  const suites = findSuites(packages, targets);
  if (suites.length === 0) {
    console.error(
      targets === undefined
        ? "test-inventory: no vitest configs found in the workspace"
        : `test-inventory: nothing to collect — no package named by ${tokens.join(", ")} has a vitest config`,
    );
    process.exit(1);
  }

  const scratch = mkdtempSync(join(tmpdir(), "test-inventory-"));
  process.stderr.write(`Collecting ${suites.length} suites (no tests run)…\n`);
  try {
    const listed = await mapLimit(
      suites,
      Math.max(1, Math.min(8, availableParallelism() - 1)),
      async (suite) => {
        const { entries, failure } = await listSuite(suite, scratch);
        const side = suite.config
          .replace("vitest.config.", "")
          .replace(".ts", "");
        process.stderr.write(
          failure === undefined
            ? `  ✓ ${suite.name} ${side} (${entries.length})\n`
            : `  ✗ ${suite.name} ${side}\n`,
        );
        return { ...suite, entries, failure };
      },
    );

    const failed = listed.filter((suite) => suite.failure !== undefined);
    if (failed.length > 0) {
      console.error(`\n✗ Collection failed for ${failed.length} suite(s):\n`);
      for (const suite of failed) {
        console.error(
          `  • ${suite.name} (${suite.config})\n${suite.failure}\n`,
        );
      }
      process.exit(1);
    }

    const report = render(
      listed.map((suite) => ({
        ...suite,
        entries: suite.entries.filter((entry) =>
          matches(entry.file, suite.dir, filters),
        ),
      })),
    );
    if (flags.out === undefined) {
      process.stdout.write(report);
    } else {
      writeFileSync(flags.out, report);
      process.stderr.write(`Wrote ${flags.out}\n`);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
