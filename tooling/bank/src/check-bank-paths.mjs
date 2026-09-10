#!/usr/bin/env node
// @ts-check
/**
 * `bank.paths.json` completeness gate.
 *
 * The bank's *package* set is derived, so it cannot go stale. Everything at the
 * repo root is the opposite: a new root-level file or directory is invisible to
 * the derivation, so unless someone remembers to put it in a bundle or in
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
 * The root is asked of git, not derived from this file's own depth: a checker
 * that resolves to the wrong directory finds no inventory, takes the
 * consumer-repo branch below and exits 0, so the gate would pass while
 * enforcing nothing. An explicit root argument overrides it, which is also what
 * lets the rules be aimed at a fixture repo.
 *
 * Usage:
 *   node tooling/bank/src/check-bank-paths.mjs [repo-root]   # exit 1 naming anything unclassified
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { parseWorkspaceGlobs } from './lib/bank-closure.mjs';
import { repoRoot } from './lib/bank.mjs';

const ROOT = process.argv[2] ? resolve(process.argv[2]) : repoRoot();
const PATHS_FILE = 'bank.paths.json';

// `tooling/bank` is itself bank content — it rides the always-included `root`
// bundle — so this file arrives in every consumer repo, where there is no
// inventory to check and nothing to enforce.
if (!existsSync(join(ROOT, PATHS_FILE))) {
  console.log(`check-bank-paths: no ${PATHS_FILE} — this repo is not a bank.`);
  process.exit(0);
}

/** @type {{ bundles: { name: string, paths: string[] }[], exclude: { path: string }[] }} */
const inventory = JSON.parse(readFileSync(join(ROOT, PATHS_FILE), 'utf8'));

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
    readFileSync(join(ROOT, 'pnpm-workspace.yaml'), 'utf8'),
  ).map((glob) => glob.split('/')[0]),
);

const rootEntries = new Set(
  execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
    .map((path) => path.split('/')[0] ?? path),
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
    `\n✖ ${PATHS_FILE} does not classify ${unclassified.length} tracked root-level ${unclassified.length === 1 ? 'entry' : 'entries'}:\n`,
  );
  for (const entry of unclassified) console.error(`  ${entry}`);
  console.error(
    [
      '',
      'Each must be either distributable or deliberately withheld:',
      '  • add it to the `paths` of the bundle it belongs to, or',
      '  • add it to `exclude` with the reason a consumer never takes it.',
      '',
      `Both are edits to ${PATHS_FILE}. There is no third answer, because an`,
      'unclassified root entry is content nobody can take and nobody can see was',
      'left out.',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

console.log(
  `check-bank-paths: all ${rootEntries.size} tracked root-level entries are classified.`,
);
