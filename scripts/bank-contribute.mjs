#!/usr/bin/env node
// @ts-check
/**
 * Bank contribute — the guarded back-flow path, consumer to bank.
 *
 * Diffs a path against the bank content this repo last merged, refuses anything
 * absent from the manifest's `contributable` allowlist, scans the diff with
 * gitleaks, shows the human the whole thing, and opens a PR on the bank only
 * after they confirm in writing.
 *
 * It never runs automatically, and there is no flag to skip the confirmation.
 * Pulling from a public bank is always safe; contributing the other way is the
 * constrained direction, and it stays a decision a human makes while reading
 * the diff. `contributable` is empty by default, so this refuses everything
 * until someone puts a path in it — forgetting to maintain the list fails
 * closed, which is the correct direction.
 *
 * The allowlist is a human's judgement, not a rule the machine can infer.
 * **Layer is not the test:** a `shared/` package can still be domain-tied, and
 * gitleaks catches credentials, not client context — it will not flag an
 * internal ticket number or a client domain term in a comment. See docs/bank.md.
 *
 * Usage:
 *   node scripts/bank-contribute.mjs <path> [<path>...]   # or: pnpm bank:contribute
 *
 * Exit codes:
 *   0  the PR was opened, or there was nothing to contribute
 *   1  refused, aborted, or failed — nothing was opened
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

import {
  BankError,
  MANIFEST,
  VENDOR_BRANCH,
  VENDOR_REF,
  defaultBranch,
  enterRepoRoot,
  fail,
  git,
  gitOrNull,
  githubSlug,
  readManifest,
  repoRelative,
  under,
  vendorBankSha,
} from "./lib/bank.mjs";

const EXIT_ERROR = 1;

/**
 * What the human types to proceed. A whole word rather than `y`, so that no
 * stray keystroke and no `yes |` in front of the command can publish code by
 * accident.
 */
const CONFIRMATION = "contribute";

/**
 * The paths named on the command line.
 *
 * Options are rejected wholesale rather than ignored, so that a `--yes` picked
 * up from some other tool fails loudly here instead of looking like it worked.
 * There is deliberately no such flag.
 *
 * @param {string[]} args
 * @returns {string[]}
 */
function requestedPaths(args) {
  const options = args.filter((arg) => arg.startsWith("-"));
  if (options.length)
    return fail(
      [
        `unknown option${options.length === 1 ? "" : "s"} ${options.join(" ")} — usage: bank:contribute <path> [<path>...]`,
        "",
        "There is no flag to skip the confirmation. A human reads the diff, every time.",
      ].join("\n"),
    );

  const paths = args.map((arg) => repoRelative(arg, "path"));
  if (paths.length === 0)
    return fail("usage: pnpm bank:contribute <path> [<path>...]");
  return paths;
}

/**
 * The allowlist gate. Runs before anything is fetched, cloned or scanned, so a
 * refusal costs nothing and reaches the network with nothing.
 *
 * @param {string[]} paths
 * @param {import("./lib/bank.mjs").Manifest} manifest
 */
function assertContributable(paths, manifest) {
  if (manifest.contributable.length === 0)
    return fail(
      [
        `"contributable" in ${MANIFEST} is empty, so there is nothing this repo may contribute.`,
        "",
        "That is the default and it fails closed on purpose. Back-flow is opt-in one",
        "path at a time, by a human who has read that path and decided it is generic",
        "enough to publish to a public repo.",
        "",
        `Add the path to "contributable" in ${MANIFEST} first, then run this again.`,
        "Layer is not the test: a shared/ package can still be tied to your domain.",
      ].join("\n"),
    );

  const refused = paths.filter(
    (path) => !manifest.contributable.some((prefix) => under(path, prefix)),
  );
  if (refused.length)
    return fail(
      [
        `not in the "contributable" allowlist: ${refused.join(", ")}`,
        "",
        `Allowed today: ${manifest.contributable.join(", ")}`,
        "",
        `Add the path to "contributable" in ${MANIFEST} if it is genuinely generic.`,
        "Read it first — the allowlist is the only thing standing between your",
        "client's code and a public repo.",
      ].join("\n"),
    );
}

/**
 * The bank commit this repo's vendored content actually sits on.
 *
 * The baseline is the merge base of `HEAD` and the vendor branch — the last
 * vendor commit merged in, not the vendor tip, so a sync that has been run but
 * not merged does not turn into a patch that reverts the bank. That vendor
 * commit records the bank sha it was built from, which is the commit the PR
 * branch is cut from, so the patch applies to the bank by construction.
 *
 * @returns {{ base: string, bankSha: string }}
 */
function patchBase() {
  const vendor = gitOrNull(["rev-parse", "--verify", "--quiet", VENDOR_REF]);
  if (!vendor)
    return fail(
      `${VENDOR_BRANCH} does not exist — this repo has never synced, so there is no bank content to diff against. Run pnpm bank:sync.`,
    );

  const base = gitOrNull(["merge-base", "HEAD", vendor]);
  if (!base)
    return fail(
      `${VENDOR_BRANCH} has never been merged into this branch, so there is no common base to diff against. Merge it first.`,
    );

  const bankSha = vendorBankSha(base);
  if (!bankSha)
    return fail(
      `the vendor commit ${base.slice(0, 8)} records no bank commit, so it was not written by bank:sync. ${VENDOR_BRANCH} must hold upstream content only.`,
    );

  return { base, bankSha };
}

/**
 * The diff to send upstream: this repo's committed state at `paths` against the
 * bank content it merged. Committed only — a patch that opens a public PR
 * should come from history, not from whatever happens to be in the working
 * tree, so an uncommitted edit is an error rather than a silent inclusion.
 *
 * @param {string} base
 * @param {string[]} paths
 * @returns {string}
 */
function buildPatch(base, paths) {
  const dirty = git(["status", "--porcelain", "--", ...paths]);
  if (dirty)
    return fail(
      [
        "uncommitted changes under the requested path(s):",
        dirty,
        "",
        "Commit or stash them first. The patch is built from committed history, so",
        "what you review here is exactly what the PR would carry.",
      ].join("\n"),
    );

  return String(
    execFileSync("git", ["diff", "--binary", base, "HEAD", "--", ...paths], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    }),
  );
}

/**
 * Scan the outgoing diff for secrets, and refuse to continue without a scanner.
 *
 * `pnpm gitleaks` degrades to a warning when the binary is missing, because CI
 * enforces it there. Here it is the last automated check before code leaves a
 * private repo for a public one, so a missing scanner is a refusal.
 *
 * @param {string} root
 * @param {string} patch
 */
function scanPatch(root, patch) {
  const config = join(root, ".gitleaks.toml");
  const result = spawnSync(
    "gitleaks",
    [
      "stdin",
      "--no-banner",
      "--redact",
      ...(existsSync(config) ? ["--config", config] : []),
    ],
    { input: patch, encoding: "utf8" },
  );

  if (result.error)
    return fail(
      [
        `gitleaks could not be run (${result.error.message}).`,
        "",
        "The secret scan is not optional on the way out. Install it and try again:",
        "  brew install gitleaks",
      ].join("\n"),
    );

  if (result.status !== 0)
    return fail(
      [
        "gitleaks flagged the diff. Nothing has been opened.",
        "",
        [result.stdout, result.stderr]
          .map((stream) => String(stream ?? "").trim())
          .filter(Boolean)
          .join("\n"),
      ]
        .join("\n")
        .trimEnd(),
    );
}

/**
 * Show the human what would be published and make them type the word. Reads a
 * line rather than a keypress, and takes nothing but the exact word, so the
 * decision has to be made deliberately.
 *
 * @param {string[]} paths
 */
async function confirm(paths) {
  console.log(
    [
      "",
      `The diff above is what would be published to a public repo, from ${paths.join(", ")}.`,
      "",
      "gitleaks found no credentials in it. It does not catch client context:",
      "internal ticket numbers, client domain terms, hostnames, names of people.",
      "Those are not secrets and they are still not yours to publish. Read the diff.",
      "",
    ].join("\n"),
  );

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(
      `Type "${CONFIRMATION}" to open the PR, or anything else to abort: `,
    );
    if (answer.trim() !== CONFIRMATION)
      return fail("aborted — nothing was opened.");
  } finally {
    rl.close();
  }
}

/**
 * Commit the patch onto a branch cut from the bank commit this repo merged, push
 * it, and open the PR.
 *
 * The clone is a throwaway. It is left on disk when the push fails, because at
 * that point it holds the only copy of the prepared commit and the human needs
 * it to push somewhere they can write.
 *
 * @param {object} args
 * @param {import("./lib/bank.mjs").Manifest} args.manifest
 * @param {string} args.bankSha
 * @param {string[]} args.paths
 * @param {string} args.patch
 */
function openPullRequest({ manifest, bankSha, paths, patch }) {
  const head = git(["rev-parse", "--short", "HEAD"]);
  const branch = `contribute/${paths[0].replace(/[^A-Za-z0-9._-]+/g, "-")}-${head}`;
  const base = defaultBranch(manifest.upstream);
  const title = `contribute ${paths.join(", ")} from a consumer`;
  const body = [
    `Back-flow from a repo consuming this bank, opened with \`pnpm bank:contribute\`.`,
    "",
    `- Based on bank commit \`${bankSha}\`, the commit this consumer last merged.`,
    `- Paths: ${paths.map((path) => `\`${path}\``).join(", ")}`,
    `- The consumer listed each of these in \`contributable\`, a human read the diff,`,
    "  and gitleaks found no credentials in it.",
    "",
    "Reviewer: gitleaks does not catch client context. Read the diff for internal",
    "ticket numbers, domain terms and hostnames that are not secrets and still do",
    "not belong in a public repo.",
  ].join("\n");

  const work = mkdtempSync(join(tmpdir(), "bank-contribute-"));
  const clone = join(work, "bank");
  git(["clone", "--quiet", manifest.upstream, clone]);
  git(["checkout", "--quiet", "-b", branch, bankSha], { cwd: clone });
  git(["apply", "--index", "--whitespace=nowarn", "-"], {
    cwd: clone,
    input: patch,
  });
  git(["commit", "--quiet", "-m", `${title}\n\n${body}`], { cwd: clone });

  if (
    gitOrNull(["push", "--quiet", "origin", branch], { cwd: clone }) ===
    undefined
  )
    return fail(
      [
        `could not push ${branch} to ${manifest.upstream} — you may not have write access.`,
        "",
        "The commit is prepared and waiting here:",
        `  ${clone}`,
        "",
        "Push it to a fork you can write to, then open the PR from there:",
        `  git -C ${clone} remote add fork <your-fork-url>`,
        `  git -C ${clone} push fork ${branch}`,
      ].join("\n"),
    );

  const slug = githubSlug(manifest.upstream);
  if (!slug)
    return console.log(
      [
        `Pushed ${branch} to ${manifest.upstream}.`,
        "",
        `The bank is not on GitHub, so open the PR against ${base} yourself.`,
      ].join("\n"),
    );

  execFileSync(
    "gh",
    [
      "pr",
      "create",
      "--repo",
      slug,
      "--base",
      base,
      "--head",
      branch,
      "--title",
      title,
      "--body",
      body,
    ],
    { stdio: "inherit" },
  );
}

async function main() {
  const paths = requestedPaths(process.argv.slice(2));
  const root = enterRepoRoot();
  const manifest = readManifest(root);

  assertContributable(paths, manifest);

  const { base, bankSha } = patchBase();
  const patch = buildPatch(base, paths);
  if (patch.trim() === "") {
    console.log(
      `Nothing to contribute — ${paths.join(", ")} matches the bank at ${bankSha.slice(0, 8)}.`,
    );
    return;
  }

  console.log(patch);
  scanPatch(root, patch);
  await confirm(paths);
  openPullRequest({ manifest, bankSha, paths, patch });
}

try {
  await main();
} catch (error) {
  // Every abort path lands here before anything is pushed, so a failure always
  // leaves the bank untouched.
  if (!(error instanceof BankError)) throw error;
  console.error(`bank:contribute: ${error.message}`);
  process.exit(EXIT_ERROR);
}
