#!/usr/bin/env node
// @ts-check
/**
 * Distributable content naming this repo.
 *
 * `check:portable` holds the rules that are structural — a citation carries a
 * path, an issue number resolves nowhere else. This one is the other half, and
 * it cannot be structural: a repo's name, its owner and its app names are just
 * words, and only *this* repo knows which words those are. So the rule lives
 * with the bank rather than in the shared lint, and it asks the inventory what
 * is distributable and git what this repo is called.
 *
 * Distributable is derived, never listed: `check-bank-paths.mjs` already
 * guarantees every tracked root-level entry is a bundle path, an `exclude`
 * entry, or a workspace root whose packages the derivation offers. So what a
 * consumer can receive is everything tracked that `exclude` does not cover, and
 * this file's scope keeps holding as bundles change.
 *
 * Two sanctioned exceptions, and no more:
 *
 *   - `docs/bank.md`, the only allowlisted *file*. It is addressed to a
 *     consumer about consuming this repo, so naming this repo in it is the
 *     point.
 *   - A `scripts` entry in the **root manifest** — see `SANCTIONED_DANGLING`.
 *     Not a file: every other line of `package.json` is in scope.
 *
 * A hard failure. It landed report-only first, so the count the rule produced
 * across the whole repo was reviewable before the sweep that cleared it was
 * made in its name.
 *
 * Usage:
 *   node tooling/bank/src/check-bank-tokens.mjs [repo-root]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { gitOrNull, repoRoot } from './lib/bank.mjs';

const rootArg = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
const ROOT = rootArg ? resolve(rootArg) : repoRoot();
const PATHS_FILE = 'bank.paths.json';

// Like the paths gate: this file rides the always-included `root` bundle, so it
// arrives in every consumer, where there is no inventory and nothing is being
// distributed onwards.
if (!existsSync(join(ROOT, PATHS_FILE))) {
  console.log(`check-bank-tokens: no ${PATHS_FILE} — this repo is not a bank.`);
  process.exit(0);
}

/** @type {{ exclude: { path: string }[] }} */
const inventory = JSON.parse(readFileSync(join(ROOT, PATHS_FILE), 'utf8'));

/** Addressed to a consumer about consuming this repo — naming it is the point. */
const ALLOWED = new Set(['docs/bank.md']);

/** The one manifest whose script entries may name content a consumer lacks. */
const ROOT_MANIFEST = 'package.json';

/**
 * Why a root `package.json` script entry may name an app.
 *
 * `bootstrap.test.ts` already sanctions a root script entry left *dangling* by
 * a selection: a consumer who took none of the feature a convenience command
 * delegates into gets an entry that calls nothing. The grounds are that the entry *is* the whole reference — key
 * and command are one line, the manifest is documented as the consumer's to
 * edit, and `docs/bank.md` names each dangling entry in a table.
 *
 * Naming an app rather than a feature does not weaken any of that. It
 * strengthens it: `apps/` is the one directory no consumer receives at all, so
 * `build:<app>` is guaranteed dangling rather than conditionally so — nothing
 * to half-work, nothing to diagnose, one line to delete.
 *
 * What the exemption does *not* cover is a script **body**. There is no line to
 * delete inside one, nothing documents it, and a consumer who runs the command
 * gets a failure rather than a missing convenience. That is the reason
 * `scripts/extract-app.sh` derives its target from `apps/*` and refuses without
 * an argument, instead of defaulting to one of this repo's apps.
 */
const SANCTIONED_DANGLING =
  'A root package.json script entry is one line the consumer deletes, and the ' +
  'bank documents it as dangling. A script body is not — derive the app there.';

/**
 * The line numbers of the root manifest's `scripts` entries.
 *
 * Read off the text rather than the parse, because the exemption is per *line*
 * and only the text has lines. Derived from the parsed keys, so it covers
 * whatever the manifest happens to declare.
 *
 * @param {string} text
 * @returns {Set<number>}
 */
function scriptEntryLines(text) {
  /** @type {{ scripts?: Record<string, unknown> }} */
  const parsed = JSON.parse(text);
  const keys = new Set(Object.keys(parsed.scripts ?? {}));
  /** @type {Set<number>} */
  const lines = new Set();

  for (const [index, line] of text.split('\n').entries()) {
    const key = /^\s*"([^"]+)"\s*:/.exec(line)?.[1];
    if (key !== undefined && keys.has(key)) lines.add(index + 1);
  }

  return lines;
}

/** Text a token can hide in. Anything else is read as bytes, never as prose. */
const TEXT = new Set([
  'cjs',
  'cts',
  'hbs',
  'js',
  'json',
  'jsonc',
  'jsx',
  'md',
  'mdx',
  'mjs',
  'mts',
  'sh',
  'toml',
  'ts',
  'tsx',
  'txt',
  'yaml',
  'yml',
  'zsh',
]);

const tracked = execFileSync('git', ['ls-files', '-z'], {
  cwd: ROOT,
  encoding: 'utf8',
})
  .split('\0')
  .filter(Boolean);

/**
 * What a consumer can receive: everything tracked, minus what `exclude` covers.
 *
 * @param {string} path
 * @returns {boolean}
 */
const distributable = (path) =>
  !inventory.exclude.some(
    (entry) => path === entry.path || path.startsWith(`${entry.path}/`),
  );

/**
 * This repo's identity, as the words a distributed file must not contain.
 *
 * The owner and the repo name come from the remote, which is the only place a
 * repo is told its own name; the directory is the fallback, for a clone with no
 * remote. Apps come from the workspace, on the same convention `exclude` uses
 * when it withholds `apps` as consumer identity.
 *
 * @returns {string[]}
 */
function identity() {
  const tokens = new Set();

  const remote = gitOrNull(['-C', ROOT, 'remote', 'get-url', 'origin']);
  const slug = remote?.match(/(?:[/:])([^/:]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (slug?.[1] && slug[2]) {
    tokens.add(slug[1]);
    tokens.add(slug[2]);
  } else {
    tokens.add(ROOT.split('/').pop() ?? '');
  }

  for (const path of tracked) {
    const app = /^apps\/([\w.-]+)\/package\.json$/.exec(path)?.[1];
    if (app === undefined) continue;
    tokens.add(app);
    const name = /"name"\s*:\s*"([^"]+)"/.exec(
      readFileSync(join(ROOT, path), 'utf8'),
    )?.[1];
    if (name) tokens.add(name);
  }

  tokens.delete('');
  return [...tokens].sort();
}

const tokens = identity();

/**
 * A token matched as a whole word, case-insensitively — a name is the same name
 * however it is capitalised, and a token inside a longer hyphenated word is a
 * different word, not the app.
 *
 * A `/` before the token counts as a boundary rather than blocking the match:
 * the two spellings that matter most, `<owner>/<repo>` and `vendor/<repo>`,
 * both write the name after a slash.
 *
 * @param {string} token
 * @returns {RegExp}
 */
const pattern = (token) =>
  new RegExp(
    `(?<![\\w-])${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`,
    'i',
  );

const patterns = tokens.map((token) => ({ token, match: pattern(token) }));

/** @type {string[]} */
const findings = [];

for (const path of tracked) {
  if (ALLOWED.has(path) || !distributable(path)) continue;
  if (!TEXT.has(path.split('.').pop()?.toLowerCase() ?? '')) continue;
  // `CLAUDE.md` and `.github/copilot-instructions.md` are symlinks to
  // `AGENTS.md` — the same line reported three times otherwise.
  if (lstatSync(join(ROOT, path)).isSymbolicLink()) continue;

  const text = readFileSync(join(ROOT, path), 'utf8');
  const exempt = path === ROOT_MANIFEST ? scriptEntryLines(text) : new Set();

  for (const [index, line] of text.split('\n').entries()) {
    if (exempt.has(index + 1)) continue;
    const named = patterns
      .filter(({ match }) => match.test(line))
      .map(({ token }) => token);
    // A scoped name names the app once, not twice for the bare name inside it.
    for (const token of named) {
      if (named.some((other) => other !== token && other.includes(token))) {
        continue;
      }
      findings.push(`${path}:${index + 1}: names \`${token}\``);
    }
  }
}

if (findings.length === 0) {
  console.log(
    `check-bank-tokens: nothing distributable names ${tokens.join(', ')}.`,
  );
  process.exit(0);
}

for (const finding of findings) console.error(`  error: ${finding}`);

console.error(
  `check-bank-tokens: ${findings.length} distributable lines name ${tokens.join(', ')}. ` +
    `Content a consumer receives describes the mechanism, not this repo. ` +
    `${SANCTIONED_DANGLING}`,
);
process.exit(1);
