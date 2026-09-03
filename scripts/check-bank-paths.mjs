#!/usr/bin/env node
// @ts-check
/**
 * `bank.paths.json` completeness gate.
 *
 * The bank's *package* set is derived, so it cannot go stale
 * ([ADR 0039](../docs/adr/0039-the-selection-is-the-contract.md)). Everything at
 * the repo root is the opposite: a new root-level file or directory is invisible
 * to the derivation, so unless someone remembers to put it in a bundle or in
 * `exclude`, it silently becomes content no consumer can take and no reader can
 * see was left out.
 *
 * So every tracked root-level entry must be classified, one of three ways:
 *
 *   1. covered by a bundle path — including nested, since `scaffolding` names
 *      `turbo/generators` while the root entry is `turbo`;
 *   2. named in `exclude`, with the reason the field exists to carry; or
 *   3. a workspace root (`packages/`, `tooling/`) whose contents the package
 *      derivation already covers.
 *
 * Entries come from `git ls-files` rather than a directory listing, so the
 * untracked working dirs — `.cache`, `.turbo`, `logs`, `node_modules` — never
 * reach it.
 *
 * Usage:
 *   node scripts/check-bank-paths.mjs   # exit 1 naming anything unclassified
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseWorkspaceGlobs } from "./lib/bank-closure.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PATHS_FILE = "bank.paths.json";

// `scripts/` is itself bank content, so this file arrives in every consumer
// repo — where there is no inventory to check and nothing to enforce.
if (!existsSync(join(ROOT, PATHS_FILE))) {
  console.log(`check-bank-paths: no ${PATHS_FILE} — this repo is not a bank.`);
  process.exit(0);
}

/** @type {{ bundles: { name: string, paths: string[] }[], exclude: { path: string }[] }} */
const inventory = JSON.parse(readFileSync(join(ROOT, PATHS_FILE), "utf8"));

/** Where each classified path came from, so a diagnostic can name the source. */
const claimed = [
  ...inventory.bundles.flatMap((bundle) =>
    bundle.paths.map((path) => ({ path, source: `bundle "${bundle.name}"` })),
  ),
  ...inventory.exclude.map((entry) => ({
    path: entry.path,
    source: '"exclude"',
  })),
];

const workspaceRoots = new Set(
  parseWorkspaceGlobs(
    readFileSync(join(ROOT, "pnpm-workspace.yaml"), "utf8"),
  ).map((glob) => glob.split("/")[0]),
);

const rootEntries = new Set(
  execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" })
    .split("\0")
    .filter(Boolean)
    .map((path) => path.split("/")[0]),
);

const unclassified = [...rootEntries]
  .filter((entry) => !workspaceRoots.has(entry))
  .filter(
    (entry) =>
      // Either direction counts: a bundle may name the entry, or a path inside it.
      !claimed.some(
        ({ path }) =>
          path === entry ||
          path.startsWith(`${entry}/`) ||
          entry.startsWith(`${path}/`),
      ),
  )
  .sort();

if (unclassified.length) {
  console.error(
    `\n✖ ${PATHS_FILE} does not classify ${unclassified.length} tracked root-level ${unclassified.length === 1 ? "entry" : "entries"}:\n`,
  );
  for (const entry of unclassified) console.error(`  ${entry}`);
  console.error(
    [
      "",
      "Each must be either distributable or deliberately withheld:",
      "  • add it to the `paths` of the bundle it belongs to, or",
      "  • add it to `exclude` with the reason a consumer never takes it.",
      "",
      `Both are edits to ${PATHS_FILE}. There is no third answer, because an`,
      "unclassified root entry is content nobody can take and nobody can see was",
      "left out.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

console.log(
  `check-bank-paths: all ${rootEntries.size} tracked root-level entries are classified.`,
);
