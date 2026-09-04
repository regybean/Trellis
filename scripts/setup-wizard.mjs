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
 * Three surfaces, one derivation. `--upstream`/`--ref` with a selection is the
 * argument form, which is what makes a scripted setup repeatable and the write
 * path testable. `--list` prints what the bank offers at a ref and exits, so
 * learning a package name does not require already knowing it. A bare run opens
 * an interactive picker over that same offer and hands what it collects to the
 * same write. The picker is a shell: everything it renders comes from
 * `bankOffer` and `closurePreview`, and everything it writes goes through
 * `authorManifest`, so there is nothing behind it that only it can reach.
 *
 * Plain node and git, no dependencies: the repo this runs in has installed
 * nothing yet. The picker included — raw mode and keypress events are
 * `node:readline`, and the handful of escape sequences it needs are written out
 * here. Like `bank-sync.mjs`, this file is hand-vendored before the first sync
 * (docs/bank.md).
 *
 * Usage:
 *   node scripts/setup-wizard.mjs                       # the picker (needs a TTY)
 *   node scripts/setup-wizard.mjs --list --upstream <git url> --ref <bank tag>
 *   node scripts/setup-wizard.mjs --upstream <git url> --ref <bank tag> \
 *     [--packages @acme/ui,@acme/logger] [--bundles docs,ci] [--force]
 *
 *   # or, once the root bundle has arrived: pnpm setup:wizard -- --upstream ...
 *
 * Exit codes:
 *   0  bank.manifest.json written, the offer listed, or the review backed out of
 *   1  refused — nothing was written
 */
import { emitKeypressEvents } from "node:readline";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";

import {
  bankOffer,
  closurePreview,
  resolveInclude,
} from "./lib/bank-closure.mjs";
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

const USAGE = `usage: node scripts/setup-wizard.mjs [--list] --upstream <git url> --ref <bank tag> [--packages <names>] [--bundles <names>] [--force] — or no arguments at all, on a terminal, for the picker`;

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
        list: { type: "boolean" },
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
 * @param {string} flag
 * @param {string | undefined} value
 * @returns {string}
 */
const required = (flag, value) =>
  value?.trim() || fail(`--${flag} is required — ${USAGE}`);

/**
 * The names behind a repeatable list flag.
 *
 * Both list flags accept `a,b` and repeat, so a generated invocation can build
 * them up either way. Names are deduplicated and sorted, which makes the written
 * manifest a function of the selection rather than of the order it was given —
 * the same selection twice produces the same file whether it was typed as
 * arguments or toggled on the menu, and re-running the wizard over its own
 * previous answer is a no-op diff.
 *
 * @param {string[] | undefined} entries
 * @returns {string[]}
 */
const names = (entries) =>
  [
    ...new Set(
      (entries ?? [])
        .flatMap((entry) => entry.split(","))
        .map((name) => name.trim())
        .filter(Boolean),
    ),
  ].sort();

/* -- The offer, as text ---------------------------------------------------- */

/**
 * Bundle descriptions in the bank are paragraphs; a row is one line.
 *
 * @param {string} description
 * @param {number} [width]
 */
const summarise = (description, width = 64) => {
  const sentence = description.split(/(?<=\.)\s/)[0] ?? "";
  return sentence.length > width
    ? `${sentence.slice(0, width - 1).trimEnd()}…`
    : sentence;
};

/**
 * @param {string} line
 * @param {number} width
 */
const truncate = (line, width) =>
  line.length > width ? `${line.slice(0, width - 1)}…` : line;

/**
 * The widest name in the offer, so both readers can put what follows it in a
 * column.
 *
 * @param {import("./lib/bank-closure.mjs").Offer} offer
 */
const nameColumn = (offer) =>
  Math.max(
    ...offer.layers.flatMap(({ packages }) =>
      packages.map((pkg) => pkg.name.length),
    ),
    ...offer.bundles.map((bundle) => bundle.name.length),
    0,
  );

/**
 * `--list`: what the bank offers at a ref, grouped the way the menu groups it.
 *
 * The gap this closes is that the only way to learn a package name was to
 * already know it — a name that does not exist at the ref is a refusal after a
 * network fetch, with nothing to consult. Same derivation as the menu, so the
 * two cannot disagree about what is on offer.
 *
 * @param {import("./lib/bank-closure.mjs").Offer} offer
 * @param {{ ref: string, sha: string }} at
 * @returns {string[]}
 */
function offerLines(offer, { ref, sha }) {
  const column = nameColumn(offer);

  return [
    `The bank at ${ref} (${sha.slice(0, 8)}) offers:`,
    ...offer.layers.flatMap(({ layer, packages }) => [
      "",
      `${layer}/`,
      ...packages.map((pkg) => `  ${pkg.name.padEnd(column)}  ${pkg.path}`),
    ]),
    "",
    "bundles",
    ...offer.bundles.map(
      (bundle) =>
        `  ${bundle.name.padEnd(column)}  ${bundle.alwaysIncluded ? "always included — " : ""}${summarise(bundle.description)}`,
    ),
    "",
    "Name any of these with --packages and --bundles, or run the wizard with no",
    "arguments to pick them off a menu. Nothing has been written.",
    "",
  ];
}

/* -- The picker ------------------------------------------------------------ */

const ANSI = {
  hideCursor: "\x1b[?25l",
  showCursor: "\x1b[?25h",
  clearDown: "\x1b[0J",
  /** @param {number} n */
  up: (n) => (n > 0 ? `\x1b[${n}A` : ""),
};

/** How many pulled-in packages the preview names before it summarises. */
const PREVIEW_ROWS = 8;

/**
 * @typedef {object} Row
 * @property {"heading" | "choice"} kind
 * @property {string} label
 * @property {string} [detail]
 * @property {"package" | "bundle"} [group]
 * @property {string} [fixed] Why it cannot be toggled, when it cannot.
 */

/**
 * The menu, as rows.
 *
 * Rebuilt from the offer and the current preview on every keystroke rather than
 * mutated, because two rows are not the user's to decide: `root` arrives with
 * every selection, and `infra` is selected by a package in the closure declaring
 * `acme.infra`. Deriving both means the menu shows what the sync will do rather
 * than what was toggled.
 *
 * @param {import("./lib/bank-closure.mjs").Offer} offer
 * @param {import("./lib/bank-closure.mjs").Preview} preview
 * @returns {Row[]}
 */
function menuRows(offer, preview) {
  return [
    ...offer.layers.flatMap(({ layer, packages }) => [
      /** @type {Row} */ ({ kind: "heading", label: `${layer}/` }),
      ...packages.map(
        (pkg) =>
          /** @type {Row} */ ({
            kind: "choice",
            group: "package",
            label: pkg.name,
            detail: pkg.path,
          }),
      ),
    ]),
    /** @type {Row} */ ({ kind: "heading", label: "bundles" }),
    ...offer.bundles.map(
      (bundle) =>
        /** @type {Row} */ ({
          kind: "choice",
          group: "bundle",
          label: bundle.name,
          detail: summarise(bundle.description, 48),
          fixed: bundle.alwaysIncluded
            ? "always included"
            : bundle.name === "infra" && preview.infra
              ? "selected by your closure"
              : undefined,
        }),
    ),
  ];
}

/**
 * What the selection drags in behind it, and which choice dragged each one.
 *
 * @param {import("./lib/bank-closure.mjs").Preview} preview
 * @returns {string[]}
 */
function previewLines(preview) {
  const shown = preview.pulled.slice(0, PREVIEW_ROWS);
  const column = Math.max(...shown.map((pkg) => pkg.name.length), 0);

  return [
    "",
    preview.pulled.length
      ? `Pulled in by your selection (${preview.pulled.length}):`
      : "Nothing pulled in yet.",
    ...shown.map(
      (pkg) =>
        `  ${pkg.name.padEnd(column)}  required by ${pkg.reasons.join(", ")}`,
    ),
    ...(preview.pulled.length > shown.length
      ? [`  … and ${preview.pulled.length - shown.length} more`]
      : []),
    ...(preview.infra
      ? ["  The infra bundle comes too — a package here declares acme.infra."]
      : []),
  ];
}

/**
 * Open the checkbox menu and return what was chosen.
 *
 * Raw mode is why this needs a terminal and why it has a `finally`: a wizard
 * that leaves the shell with no echo and no cursor is worse than one that never
 * ran, so the restore covers `Ctrl-C`, an enter, and anything a render throws —
 * including a throw inside the keypress handler, which is why that handler
 * rejects rather than letting an exception escape into an event emitter, where
 * nothing would ever reach the restore.
 *
 * @param {import("./lib/bank-closure.mjs").Offer} offer
 * @param {string} header
 * @returns {Promise<{ packages: string[], bundles: string[] }>}
 */
async function pickSelection(offer, header) {
  /** @type {Set<string>} */ const packages = new Set();
  /** @type {Set<string>} */ const bundles = new Set();
  const column = nameColumn(offer);

  const current = () => {
    const preview = closurePreview(offer, [...packages]);
    return { preview, rows: menuRows(offer, preview) };
  };

  let cursor = current().rows.findIndex((row) => row.kind === "choice");
  let top = 0;
  let printed = 0;

  /**
   * @param {Row[]} rows
   * @param {import("./lib/bank-closure.mjs").Preview} preview
   * @returns {string[]}
   */
  function frame(rows, preview) {
    // `||` rather than `??`: a terminal that reports zero columns is telling us
    // it does not know, and laying out to a width of -1 renders nothing at all.
    const width = (process.stdout.columns || 80) - 1;
    const head = [header, ""];
    const tail = previewLines(preview);
    // The window is what is left of the terminal once the header, the preview
    // and the scroll line have taken theirs. Every line is truncated to the
    // width for the same reason the count matters: one wrapped line and the
    // redraw would erase the wrong number of rows.
    const room = Math.max(
      3,
      (process.stdout.rows || 24) - head.length - tail.length - 2,
    );

    if (cursor < top) top = cursor;
    if (cursor >= top + room) top = cursor - room + 1;
    top = Math.max(0, Math.min(top, rows.length - room));

    /** @param {Row} row */
    const chosen = (row) =>
      (row.group === "package" ? packages : bundles).has(row.label);

    return [
      ...head,
      ...rows.slice(top, top + room).map((row, offset) => {
        if (row.kind === "heading") return truncate(row.label, width);
        const box = row.fixed || chosen(row) ? "[x]" : "[ ]";
        const note = row.fixed ? `(${row.fixed}) ` : "";
        return truncate(
          `${top + offset === cursor ? ">" : " "} ${box} ${row.label.padEnd(column)}  ${note}${row.detail ?? ""}`,
          width,
        );
      }),
      rows.length > room ? `  … ${rows.length - room} more, keep going` : "",
      ...tail.map((line) => truncate(line, width)),
    ];
  }

  const render = () => {
    const { rows, preview } = current();
    const lines = frame(rows, preview);
    process.stdout.write(
      `${ANSI.up(printed)}\r${ANSI.clearDown}${lines.join("\n")}\n`,
    );
    printed = lines.length;
  };

  /** @param {number} delta */
  const move = (delta) => {
    const { rows } = current();
    for (
      let next = cursor + delta;
      next >= 0 && next < rows.length;
      next += delta
    ) {
      if (rows[next].kind === "choice") {
        cursor = next;
        return;
      }
    }
  };

  const toggle = () => {
    const row = current().rows[cursor];
    if (row.kind !== "choice" || row.fixed) return;
    const set = row.group === "package" ? packages : bundles;
    if (!set.delete(row.label)) set.add(row.label);
  };

  /** @type {(chunk: string, key: { name?: string, ctrl?: boolean }) => void} */
  let onKey = () => {};
  const onResize = () => render();

  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdout.write(ANSI.hideCursor);

  try {
    await new Promise((resolve, reject) => {
      onKey = (_chunk, key) => {
        try {
          if (key.ctrl && key.name === "c")
            return reject(
              new BankError(`cancelled — no ${MANIFEST} has been written.`),
            );
          if (key.name === "return" || key.name === "enter")
            return resolve(undefined);
          if (key.name === "up" || key.name === "k") move(-1);
          else if (key.name === "down" || key.name === "j") move(1);
          else if (key.name === "space") toggle();
          else return;
          render();
        } catch (error) {
          reject(error);
        }
      };

      process.stdin.on("keypress", onKey);
      process.stdout.on("resize", onResize);
      render();
    });
  } finally {
    process.stdin.off("keypress", onKey);
    process.stdout.off("resize", onResize);
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdout.write(ANSI.showCursor);
  }

  return { packages: [...packages].sort(), bundles: [...bundles].sort() };
}

/**
 * One line of input, on the terminal the picker already requires.
 *
 * @param {string} question
 */
async function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } catch (error) {
    // Ctrl-D at a prompt is an answer — stop, having written nothing. readline
    // reports it as an `AbortError`, which unhandled would end a wizard run in
    // a stack trace.
    if (!(error instanceof Error) || error.name !== "AbortError") throw error;
    return fail(`cancelled — no ${MANIFEST} has been written.`);
  } finally {
    rl.close();
  }
}

/* -- Writing --------------------------------------------------------------- */

/**
 * Turn a selection into the manifest, whichever surface collected it.
 *
 * Both paths land here, which is what makes a picker run and the equivalent
 * argument run produce the same file. `confirm` is the picker's review step: it
 * sees the manifest and the paths it resolved to, and answering no leaves the
 * repo exactly as it was.
 *
 * @param {string} root
 * @param {Options} options
 * @param {string} sha
 * @param {import("./lib/bank-closure.mjs").Offer} offer
 * @param {(manifest: import("./lib/bank.mjs").Manifest, include: string[]) => Promise<boolean>} [confirm]
 */
async function authorManifest(root, options, sha, offer, confirm) {
  // `--force` replaces a *selection*. `omit` and `contributable` are the two
  // fields a consumer maintains by hand as it matures, and no selection passed
  // here can reconstruct either, so they are carried across rather than reset —
  // otherwise a re-run silently drops an allowlist someone reviewed path by
  // path. Without `--force` there is nothing to carry: the write refuses.
  const existing = options.force ? readManifestIfAny(root) : undefined;

  // A bundle the bank marks `alwaysIncluded` arrives whether or not the manifest
  // names it, so recording it is noise that reads like an opt-in — and would
  // read like an opt-*out* were it ever removed. Asking for what you were
  // getting anyway is a reasonable thing to type, so it is dropped and said so
  // rather than refused. The flag is read off the offer at `sha`, which is why
  // nothing here says `root`; an unknown name is left in for `resolveInclude`
  // to reject, so the "no such bundle" message stays in one place.
  const always = offer.bundles
    .filter((bundle) => bundle.alwaysIncluded)
    .map((bundle) => bundle.name);
  const dropped = options.bundles.filter((name) => always.includes(name));
  if (dropped.length)
    console.log(
      `Not recording ${dropped.join(", ")} — always included, so it cannot be a choice.`,
    );

  const manifest = {
    upstream: options.upstream,
    ref: options.ref,
    packages: options.packages,
    bundles: options.bundles.filter((name) => !always.includes(name)),
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

  if (confirm && !(await confirm(manifest, include))) {
    console.log(`Backed out — no ${MANIFEST} written.`);
    return;
  }

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

/**
 * The bare run: upstream, ref, the menu, then a review.
 *
 * The manifest check comes before any of it. `writeManifest` would refuse at the
 * end anyway, but refusing after someone has typed a URL and toggled their way
 * down a menu is a worse way to learn it.
 *
 * @param {string} root
 * @param {boolean} force
 */
async function runPicker(root, force) {
  if (!force && readManifestIfAny(root))
    fail(
      `${MANIFEST} already exists at ${root} — edit it, or re-run with --force to replace it. Nothing has been written.`,
    );

  console.log(
    [
      "Setting up a bank consumer. Two questions, then a menu.",
      "",
      "The bank's canonical branch is main, and known-good sync points are tagged",
      "bank/YYYY-MM-DD — pin a tag rather than a branch. To see them:",
      "",
      "  git ls-remote --tags <bank url> 'refs/tags/bank/*'",
      "",
    ].join("\n"),
  );

  const upstream =
    (await ask("Bank git URL: ")) ||
    fail(`no bank URL given — nothing has been written. ${USAGE}`);
  const ref =
    (await ask("Bank ref (a tag like bank/2026-08-26): ")) ||
    fail(`no bank ref given — nothing has been written. ${USAGE}`);

  const sha = fetchBank(upstream, ref);
  const offer = bankOffer(sha);

  const selection = await pickSelection(
    offer,
    `${ref} (${sha.slice(0, 8)}) — ↑/↓ moves, space toggles, enter confirms, Ctrl-C aborts.`,
  );

  await authorManifest(
    root,
    { upstream, ref, ...selection, force },
    sha,
    offer,
    async (manifest, include) => {
      console.log(
        [
          "",
          "Your selection:",
          `  packages: ${manifest.packages.join(", ") || "(none)"}`,
          `  bundles:  ${manifest.bundles.join(", ") || "(none)"}`,
          `  covering ${include.length} path(s) at ${ref} (${sha.slice(0, 8)}).`,
          "",
        ].join("\n"),
      );
      return /^y(es)?$/i.test(await ask(`Write ${MANIFEST}? [y/N] `));
    },
  );
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const root = enterRepoRoot();

  const packages = names(flags.packages);
  const bundles = names(flags.bundles);
  const force = flags.force === true;

  if (flags.list) {
    const ref = required("ref", flags.ref);
    const sha = fetchBank(required("upstream", flags.upstream), ref);
    console.log(offerLines(bankOffer(sha), { ref, sha }).join("\n"));
    return;
  }

  // Nothing to go on. On a terminal that is the picker's cue; piped or in CI
  // there is no terminal to drive and half a menu in a pipe helps nobody, so it
  // names the form that does work there instead.
  if (!flags.upstream && !flags.ref && !packages.length && !bundles.length) {
    if (!process.stdin.isTTY || !process.stdout.isTTY)
      fail(
        `no selection given, and no terminal to open the picker on — pass it as arguments instead. ${USAGE}`,
      );
    return runPicker(root, force);
  }

  const options = {
    upstream: required("upstream", flags.upstream),
    ref: required("ref", flags.ref),
    packages,
    bundles,
    force,
  };

  const sha = fetchBank(options.upstream, options.ref);
  await authorManifest(root, options, sha, bankOffer(sha));
}

try {
  await main();
} catch (error) {
  // The manifest is written last, so every abort path above leaves the repo
  // exactly as it was.
  if (!(error instanceof BankError)) throw error;
  console.error(`setup:wizard: ${error.message}`);
  process.exit(EXIT_ERROR);
}
