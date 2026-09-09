#!/usr/bin/env node
// @ts-check
/**
 * Distributable content naming this repo.
 *
 * `check:portable` holds the rules that are structural — a citation carries a
 * path, an issue number resolves nowhere else. This one is the other half, and
 * it cannot be structural: "Trellis", "regybean" and "nextjs" are just words,
 * and only *this* repo knows they are its own name, its owner and one of its
 * apps. So the rule lives with the bank rather than in the shared lint, and it
 * asks the inventory what is distributable and git what this repo is called.
 *
 * Distributable is derived, never listed: `check-bank-paths.mjs` already
 * guarantees every tracked root-level entry is a bundle path, an `exclude`
 * entry, or a workspace root whose packages the derivation offers. So what a
 * consumer can receive is everything tracked that `exclude` does not cover, and
 * this file's scope keeps holding as bundles change.
 *
 * `docs/bank.md` is the one sanctioned exception. It is addressed to a consumer
 * about consuming Trellis, so naming Trellis in it is correct.
 *
 * **Report-only for now.** The repo has a backlog that predates the rule, so
 * the count is printed and the exit code stays 0. The sweep that clears the
 * backlog deletes the `REPORTED` cap and the exit below.
 *
 * One thing in that backlog is unsettled rather than merely unfixed: the root
 * manifest's `build:nextjs` and `build:tanstack-slim`, and `scripts/extract-app.sh`,
 * which defaults to `@acme/nextjs`. `bootstrap.test.ts` already sanctions a
 * manifest entry left *dangling* by a selection, on the grounds that a consumer
 * deletes it in one line — but whether a sanctioned dangling entry may also
 * name an app is a different question, and nobody has answered it. Reported so
 * the question is visible; the answer belongs to the change that turns these
 * checks on. `lint:mastra` is the same question about a feature rather than an
 * app, and the token set does not reach it: only apps are consumer identity.
 *
 * Usage:
 *   node tooling/bank/src/check-bank-tokens.mjs [repo-root] [--all]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { gitOrNull, repoRoot } from './lib/bank.mjs';

const args = process.argv.slice(2);
const rootArg = args.find((arg) => !arg.startsWith('--'));
const ROOT = rootArg ? resolve(rootArg) : repoRoot();
const PATHS_FILE = 'bank.paths.json';

/** Files listed before the rest are summarised. `--all` prints every one. */
const REPORTED = args.includes('--all') ? Infinity : 20;

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
 * A token matched as a whole word, case-insensitively — `trellis` and `Trellis`
 * are the same name, and `nextjs` inside `nextjs-canary` is not the app.
 *
 * A `/` before the token counts as a boundary rather than blocking the match:
 * the two spellings that matter most, `regybean/Trellis` and `vendor/trellis`,
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

  const lines = readFileSync(join(ROOT, path), 'utf8').split('\n');
  for (const [index, line] of lines.entries()) {
    const named = patterns
      .filter(({ match }) => match.test(line))
      .map(({ token }) => token);
    // `@acme/nextjs` names the app once, not twice for the bare name inside it.
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

for (const finding of findings.slice(0, REPORTED)) {
  console.error(`  warn: ${finding}`);
}
if (findings.length > REPORTED) {
  console.error(
    `  warn: …and ${findings.length - REPORTED} more. Run \`pnpm check:bank-tokens --all\` to see them.`,
  );
}

console.log(
  `check-bank-tokens: ${findings.length} distributable lines name ${tokens.join(', ')} ` +
    `— reporting only, not failing the gate yet. Content a consumer receives should ` +
    `describe the mechanism, not this repo.`,
);
