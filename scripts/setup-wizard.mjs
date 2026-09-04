#!/usr/bin/env node
// @ts-check
/**
 * Setup wizard — author a consumer's `bank.manifest.json` from a selection.
 *
 * This is the first command a repo adopting the bank runs. It writes one file
 * and stops: the manifest naming the packages and bundles you take
 * ([ADR 0039](../docs/adr/0039-the-selection-is-the-contract.md)). It never
 * copies anything, never writes into `packages/`, and never touches the working
 * tree beyond that one file. `bank:sync` moves files, so seeding a new repo and
 * updating an old one are the same code path and the first sync is exercised on
 * day one rather than being a separate untested step.
 *
 * It records the names you gave and nothing more. The transitive closure is
 * **not** expanded into `packages`, because the sync resolves it at the pinned
 * ref — expanding it here would put back the authoring-time snapshot ADR 0039
 * removed, correct the day it is written and stale on the next upstream
 * dependency edit. What it does do is resolve the closure once, before writing,
 * to check every name exists at `ref`: the same failure the sync would give,
 * moved to the point where it is cheap to fix.
 *
 * This file is the non-interactive half — a selection passed as arguments, which
 * is what makes a scripted setup repeatable and the behaviour testable. The
 * interactive picker is a shell over the same path.
 *
 * Plain node and git, no dependencies: the repo this runs in has installed
 * nothing yet. Like `bank-sync.mjs`, it is hand-vendored before the first sync
 * (docs/bank.md).
 *
 * Usage:
 *   node scripts/setup-wizard.mjs --upstream <git url> --ref <bank tag> \
 *     [--packages @acme/ui,@acme/logger] [--bundles docs,ci] [--force]
 *
 *   # or, once the root bundle has arrived: pnpm setup:wizard -- --upstream ...
 *
 * Exit codes:
 *   0  bank.manifest.json written
 *   1  refused — nothing was written
 */
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { bankBundles, resolveInclude } from "./lib/bank-closure.mjs";
import {
  BankError,
  MANIFEST,
  enterRepoRoot,
  fail,
  fetchBank,
} from "./lib/bank.mjs";

const EXIT_ERROR = 1;

const USAGE = `usage: setup:wizard --upstream <git url> --ref <bank tag> [--packages <names>] [--bundles <names>] [--force]`;

/** Flags taking one value. */
const VALUE_FLAGS = ["--upstream", "--ref"];

/** Flags taking a comma-separated list, repeatable. */
const LIST_FLAGS = ["--packages", "--bundles"];

/**
 * @typedef {object} Options
 * @property {string} upstream
 * @property {string} ref
 * @property {string[]} packages
 * @property {string[]} bundles
 * @property {boolean} force
 */

/**
 * Parse the selection off the command line.
 *
 * Both list flags accept `a,b` and repeat, so a generated invocation can build
 * them up either way. Names are deduplicated and sorted, which makes the written
 * manifest a function of the selection rather than of the order it was typed —
 * the same selection twice produces the same file, and re-running the wizard
 * over its own previous answer is a no-op diff.
 *
 * @param {string[]} argv
 * @returns {Options}
 */
function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const values = {};
  /** @type {Record<string, string[]>} */
  const lists = { "--packages": [], "--bundles": [] };
  let force = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    // `--flag=value` and `--flag value` are the same thing to everything below.
    const split = arg.indexOf("=");
    const flag = split === -1 ? arg : arg.slice(0, split);
    const inline = split === -1 ? undefined : arg.slice(split + 1);

    if (flag === "--force") {
      force = true;
      continue;
    }

    if (!VALUE_FLAGS.includes(flag) && !LIST_FLAGS.includes(flag))
      return fail(`unknown argument ${arg} — ${USAGE}`);

    const value = inline ?? argv[++i];
    if (value === undefined) return fail(`${flag} needs a value — ${USAGE}`);

    if (LIST_FLAGS.includes(flag))
      lists[flag].push(...value.split(",").map((entry) => entry.trim()));
    else values[flag] = value.trim();
  }

  /** @param {string} flag */
  const required = (flag) =>
    values[flag] || fail(`${flag} is required — ${USAGE}`);

  /** @param {string} flag */
  const list = (flag) => [...new Set(lists[flag].filter(Boolean))].sort();

  return {
    upstream: required("--upstream"),
    ref: required("--ref"),
    packages: list("--packages"),
    bundles: list("--bundles"),
    force,
  };
}

/**
 * The bundle names worth recording: the ones that were a choice.
 *
 * A bundle the bank marks `alwaysIncluded` arrives whether or not the manifest
 * names it, so naming it is noise that reads like an opt-in — and would read
 * like an opt-*out* were it ever removed. Selecting one is not an error, since
 * asking for what you were getting anyway is a reasonable thing to type; it is
 * dropped and said aloud. Which bundles those are is read from the bank at
 * `sha`, so nothing here hardcodes `root`.
 *
 * Unknown names are left in place for `resolveInclude` to reject, so the "no
 * such bundle" message stays in one file.
 *
 * @param {string} sha
 * @param {string[]} selected
 * @returns {string[]}
 */
function chosenBundles(sha, selected) {
  const always = bankBundles(sha)
    .filter((bundle) => bundle.alwaysIncluded)
    .map((bundle) => bundle.name);

  const dropped = selected.filter((name) => always.includes(name));
  if (dropped.length)
    console.log(
      `Not recording ${dropped.join(", ")} — always included, so it cannot be a choice.`,
    );

  return selected.filter((name) => !always.includes(name));
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const root = enterRepoRoot();

  const path = join(root, MANIFEST);
  if (existsSync(path) && !options.force)
    return fail(
      `${MANIFEST} already exists at ${root} — edit it, or pass --force to replace it. Nothing has been written.`,
    );

  const sha = fetchBank(options.upstream, options.ref);
  const selection = {
    packages: options.packages,
    bundles: chosenBundles(sha, options.bundles),
    omit: [],
  };

  // Strict: a name that does not resolve aborts here, naming it, with no file
  // written. Resolving is also the only way to know what the selection covers,
  // which is worth showing before the sync goes and fetches it.
  const { include } = resolveInclude(sha, selection);

  writeFileSync(
    path,
    `${JSON.stringify(
      {
        upstream: options.upstream,
        ref: options.ref,
        ...selection,
        // Back-flow stays a decision a human makes while reading a diff, so the
        // allowlist is never seeded — see docs/bank.md.
        contributable: [],
      },
      null,
      2,
    )}\n`,
  );

  console.log(
    [
      `${MANIFEST} written: ${selection.packages.length} package(s), ${selection.bundles.length} chosen bundle(s).`,
      `At ${options.ref} (${sha.slice(0, 8)}) that selection covers ${include.length} path(s), resolved again on every sync.`,
      "",
      "Nothing has been copied. To take the files:",
      "",
      "  node scripts/bank-sync.mjs",
      "  git merge --allow-unrelated-histories vendor/trellis",
      "",
      "Then wire each package in by reading its ADAPTER.md.",
      "",
    ].join("\n"),
  );
}

try {
  main();
} catch (error) {
  // The manifest is written last, so every abort path above leaves the repo
  // exactly as it was.
  if (!(error instanceof BankError)) throw error;
  console.error(`setup:wizard: ${error.message}`);
  process.exit(EXIT_ERROR);
}
