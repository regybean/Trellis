/**
 * A throwaway bank and a throwaway consumer, in a temp dir, for the bank suites
 * ([ADR 0037](../../../../../docs/adr/0037-vendored-git-subset-three-way-merge.md)).
 *
 * Both halves of the bank are tested against real git repositories rather than
 * a fake: what is being asserted is what git itself does with the ancestry the
 * scripts build, so a mocked git would assert nothing. The sandbox never
 * touches the real repo — the only paths read out of it are the scripts, copied
 * in the way a consumer vendors them.
 *
 * Not a `.test.ts`, so vitest does not collect it.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// src/tests/backend -> repo root is five levels up.
export const repoRoot = resolve(here, '../../../../../');

/**
 * What a consumer vendors to get the bank commands: the two scripts and the lib
 * they share. All three live under `scripts/`, so after the first sync they
 * arrive, and update themselves, like anything else in the `root` bundle.
 */
const scriptSources = [
  'scripts/bank-sync.mjs',
  'scripts/bank-contribute.mjs',
  'scripts/lib/bank.mjs',
];

/**
 * Identity and config isolation for every git call, including the scripts' own.
 * `GIT_CONFIG_GLOBAL=/dev/null` keeps the developer's `~/.gitconfig` (aliases,
 * `merge.conflictStyle`, hooks) out of the assertions.
 */
export const gitEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 'Bank Test',
  GIT_AUTHOR_EMAIL: 'bank@test.invalid',
  GIT_COMMITTER_NAME: 'Bank Test',
  GIT_COMMITTER_EMAIL: 'bank@test.invalid',
};

const sandboxes: string[] = [];

/** Call from an `afterEach` — every sandbox this file handed out is removed. */
export function cleanupSandboxes() {
  for (const dir of sandboxes.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    env: gitEnv,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

export function write(repo: string, path: string, content: string) {
  const file = join(repo, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

export function commit(repo: string, message: string) {
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', message]);
}

export function read(repo: string, path: string) {
  return readFileSync(join(repo, path), 'utf8');
}

/** Paths a ref's tree holds, sorted — the "exactly these files" assertion. */
export function treePaths(repo: string, ref: string) {
  return git(repo, ['ls-tree', '-r', '--name-only', ref]).split('\n').sort();
}

/** A twelve-line file, so the two sides can edit non-adjacent regions of it. */
export function numberedLines(first: string, last: string) {
  return [
    first,
    ...Array.from({ length: 10 }, (_, i) => `line ${i + 2}`),
    last,
  ].join('\n');
}

export interface Sandbox {
  bank: string;
  consumer: string;
}

export interface SetupOptions {
  /** Manifest `include` — the paths the consumer takes from the bank. */
  include?: string[];
  /** Manifest `contributable` — empty by default, exactly like a real one. */
  contributable?: string[];
}

/**
 * A bank holding two vendored dirs plus a path the consumer does not take, and
 * a consumer with its own file, a manifest, and the scripts vendored under
 * `scripts/`.
 */
export function setup({
  include = ['tooling', 'turbo.json'],
  contributable = [],
}: SetupOptions = {}): Sandbox {
  const root = mkdtempSync(join(tmpdir(), 'bank-sandbox-'));
  sandboxes.push(root);
  const bank = join(root, 'bank');
  const consumer = join(root, 'consumer');

  mkdirSync(bank);
  git(bank, ['init', '-q', '-b', 'main']);
  write(bank, 'tooling/eslint.js', numberedLines('bank first', 'bank last'));
  write(bank, 'tooling/prettier.js', 'export default {};\n');
  write(bank, 'turbo.json', '{ "tasks": {} }\n');
  write(bank, 'packages/features/chat/index.ts', 'export const chat = true;\n');
  commit(bank, 'bank: initial');

  mkdirSync(consumer);
  git(consumer, ['init', '-q', '-b', 'main']);
  for (const source of scriptSources) {
    const target = join(consumer, source);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(repoRoot, source), target);
  }
  write(
    consumer,
    'bank.manifest.json',
    `${JSON.stringify({ upstream: bank, ref: 'main', include, contributable }, null, 2)}\n`,
  );
  write(consumer, 'apps/consumer/own.ts', 'export const mine = true;\n');
  commit(consumer, 'consumer: initial');

  return { bank, consumer };
}

/** Rewrites the consumer's `bank.manifest.json`, keeping the untouched fields. */
export function editManifest(
  consumer: string,
  patch: Record<string, unknown>,
  message = 'consumer: edit manifest',
) {
  const manifest: unknown = JSON.parse(read(consumer, 'bank.manifest.json'));
  write(
    consumer,
    'bank.manifest.json',
    `${JSON.stringify({ ...(manifest as object), ...patch }, null, 2)}\n`,
  );
  commit(consumer, message);
}

export interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

/** Runs a vendored bank script, returning its exit code and both streams. */
export function runScript(
  consumer: string,
  script: string,
  args: string[] = [],
  input = '',
): Run {
  const result = spawnSync('node', [script, ...args], {
    cwd: consumer,
    env: gitEnv,
    encoding: 'utf8',
    input,
  });
  if (result.error) throw result.error;
  // `status` is null only when a signal killed the child, which is a failure
  // here like any other.
  return {
    status: result.status ?? -1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

export function sync(consumer: string) {
  const run = runScript(consumer, 'scripts/bank-sync.mjs');
  if (run.status !== 0)
    throw new Error(`expected bank:sync to succeed: ${run.stderr}`);
  return run.stdout;
}

/** Merges the vendor branch the way the script tells the human to. */
export function merge(consumer: string, extra: string[] = []) {
  return git(consumer, ['merge', '--no-edit', ...extra, 'vendor/trellis']);
}

/** Sync and take the first merge — the state every later assertion starts from. */
export function syncAndMerge(consumer: string) {
  sync(consumer);
  merge(consumer, ['--allow-unrelated-histories']);
}
