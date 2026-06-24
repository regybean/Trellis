#!/usr/bin/env node
// Resolve the set of compose infra profiles required by the given apps from the
// workspace dependency graph — the single source of truth, so adding an app
// needs no change here.
//
// Each package declares the infra it actually touches in its package.json under
// `acme.infra` (e.g. ["postgres"]). An app's required infra is the UNION of
// `acme.infra` over its transitive workspace closure. Nothing is assumed on:
// an app whose closure declares nothing starts no infra.
//
// The graph yields a CANDIDATE set; env then PRUNES it for services that are
// only needed under a given configuration:
//   - `billing` (localstripe) is dropped unless STRIPE_API_BASE is set (real
//     Stripe needs no local container).
//   - `ollama` is dropped unless a model provider is `ollama` (the provider is a
//     runtime choice; the graph only says "this app does LLM/embeddings").
//
// Usage:  resolve-infra.mjs [app ...]      (no args => every app under apps/*)
//         app may be a full name (@acme/nextjs) or short (nextjs).
// Output: comma-separated profile list (possibly empty) on stdout.
//
// Run under `pnpm with-env` so env-based prunes see ./.env.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

const readPkg = (dir) =>
  JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));

// Every workspace package under apps/* — the default "run everything" set.
const appDirs = readdirSync(path.join(root, 'apps'), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => path.join(root, 'apps', e.name))
  .filter((dir) => {
    try {
      readPkg(dir);
      return true;
    } catch {
      return false;
    }
  });
const appsByName = new Map(appDirs.map((dir) => [readPkg(dir).name, dir]));

// Resolve a CLI token (full or short name) to a workspace app name.
const toAppName = (token) => {
  if (appsByName.has(token)) return token;
  const qualified = `@acme/${token}`;
  if (appsByName.has(qualified)) return qualified;
  const byDir = appDirs.find((dir) => path.basename(dir) === token);
  if (byDir) return readPkg(byDir).name;
  throw new Error(`resolve-infra: unknown app "${token}"`);
};

const targets =
  process.argv.slice(2).length > 0
    ? process.argv.slice(2).map(toAppName)
    : [...appsByName.keys()];

// One pnpm call: the union of every target's transitive workspace closure.
const filters = targets.flatMap((name) => ['--filter', `${name}...`]);
const raw = execFileSync(
  'pnpm',
  [...filters, 'ls', '--only-projects', '--depth', '-1', '--json'],
  { cwd: root, encoding: 'utf8' },
);
const projects = JSON.parse(raw);

const profiles = new Set();
for (const proj of projects) {
  const infra = readPkg(proj.path).acme?.infra;
  if (Array.isArray(infra)) for (const p of infra) profiles.add(p);
}

// Env prunes (see header).
if (!process.env.STRIPE_API_BASE) profiles.delete('billing');
const ollama =
  process.env.LLM_PROVIDER === 'ollama' ||
  process.env.EMBED_PROVIDER === 'ollama';
if (!ollama) profiles.delete('ollama');

process.stdout.write([...profiles].sort().join(','));
