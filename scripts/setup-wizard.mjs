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
import { parseArgs } from "node:util";

import { chosenBundles, resolveInclude } from "./lib/bank-closure.mjs";
import {
  BankError,
  MANIFEST,
  enterRepoRoot,
  fail,
  fetchBank,
  readManifestIfAny,
  writeManifest,
} from "./lib/bank.mjs";

const EXIT_ERROR = 1;

const USAGE = `usage: node scripts/setup-wizard.mjs --upstream <git url> --ref <bank tag> [--packages <names>] [--bundles <names>] [--force]`;

/**
 * @typedef {object} Options
 * @property {string} upstream
 * @property {string} ref
 * @property {string[]} packages
 * @property {string[]} bundles
 * @property {boolean} force
 */

/**
 * The flags, off `node:util`'s `parseArgs`.
 *
 * `--flag=value`, a repeated flag and rejecting one nobody declared are all its
 * behaviour, and it is stdlib, so the "no dependencies, nothing installed yet"
 * constraint holds. Its errors are `TypeError`s aimed at the caller, so they are
 * re-raised as the phrased-for-a-human refusal every other abort path gives.
 *
 * @param {string[]} args
 */
function parseFlags(args) {
  try {
    return parseArgs({
      args,
      allowPositionals: false,
      options: {
        upstream: { type: "string" },
        ref: { type: "string" },
        packages: { type: "string", multiple: true },
        bundles: { type: "string", multiple: true },
        force: { type: "boolean" },
      },
    }).values;
  } catch (error) {
    return fail(
      `${error instanceof Error ? error.message : String(error)} — ${USAGE}`,
    );
  }
}

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
function parseSelection(argv) {
  const flags = parseFlags(argv);

  /**
   * @param {string} flag
   * @param {string | undefined} value
   */
  const required = (flag, value) =>
    value?.trim() || fail(`--${flag} is required — ${USAGE}`);

  /** @param {string[] | undefined} entries */
  const names = (entries) =>
    [
      ...new Set(
        (entries ?? [])
          .flatMap((entry) => entry.split(","))
          .map((name) => name.trim())
          .filter(Boolean),
      ),
    ].sort();

  return {
    upstream: required("upstream", flags.upstream),
    ref: required("ref", flags.ref),
    packages: names(flags.packages),
    bundles: names(flags.bundles),
    force: flags.force === true,
  };
}

function main() {
  const options = parseSelection(process.argv.slice(2));
  const root = enterRepoRoot();

  // `--force` replaces a *selection*. `omit` and `contributable` are the two
  // fields a consumer maintains by hand as it matures, and no selection passed
  // here can reconstruct either, so they are carried across rather than reset —
  // otherwise a re-run silently drops an allowlist someone reviewed path by
  // path. Without `--force` there is nothing to carry: the write refuses.
  const existing = options.force ? readManifestIfAny(root) : undefined;

  const sha = fetchBank(options.upstream, options.ref);
  const { bundles, dropped } = chosenBundles(sha, options.bundles);
  if (dropped.length)
    console.log(
      `Not recording ${dropped.join(", ")} — always included, so it cannot be a choice.`,
    );

  const manifest = {
    upstream: options.upstream,
    ref: options.ref,
    packages: options.packages,
    bundles,
    omit: existing?.omit ?? [],
    // Back-flow stays a decision a human makes while reading a diff, so the
    // allowlist is never seeded — see docs/bank.md.
    contributable: existing?.contributable ?? [],
  };

  // Strict: a name that does not resolve aborts here, naming it, with no file
  // written. Resolving is also the only way to know what the selection covers,
  // which is worth showing before the sync goes and fetches it.
  const { include, warnings } = resolveInclude(sha, manifest);
  for (const warning of warnings) console.log(warning);

  writeManifest(root, manifest, { replace: options.force });

  const kept = manifest.omit.length + manifest.contributable.length;
  console.log(
    [
      `${MANIFEST} written: ${manifest.packages.length} package(s), ${manifest.bundles.length} chosen bundle(s).`,
      ...(kept
        ? [
            `Kept "omit" (${manifest.omit.length}) and "contributable" (${manifest.contributable.length}) from the manifest it replaced — a selection cannot reconstruct either.`,
          ]
        : []),
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
