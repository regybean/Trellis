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
 * What a consumer vendors to get the bank commands: the three scripts and the two
 * libs they share. All five live under `scripts/`, so after the first sync they
 * arrive, and update themselves, like anything else in the `root` bundle.
 */
const scriptSources = [
  'scripts/bank-sync.mjs',
  'scripts/bank-contribute.mjs',
  'scripts/setup-wizard.mjs',
  'scripts/lib/bank.mjs',
  'scripts/lib/bank-closure.mjs',
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
  /** Manifest `packages` — the workspace package names the consumer takes. */
  packages?: string[];
  /** Manifest `bundles` — the named path groups it takes alongside them. */
  bundles?: string[];
  /** Manifest `omit` — closure paths it supplies itself. */
  omit?: string[];
  /** Manifest `contributable` — empty by default, exactly like a real one. */
  contributable?: string[];
  /**
   * Write the manifest at all. `false` leaves the consumer without one, which
   * is the state `setup:wizard` runs in — it is the thing that authors it.
   */
  manifest?: boolean;
}

/**
 * Write a workspace package: a `package.json` plus a source file, so the
 * package is both a graph node and a thing with content to merge.
 */
export function writePackage(
  bank: string,
  path: string,
  pkg: Record<string, unknown>,
  source = 'export const value = true;\n',
) {
  write(bank, `${path}/package.json`, `${JSON.stringify(pkg, null, 2)}\n`);
  write(bank, `${path}/index.js`, source);
}

/**
 * A bank that is a real pnpm workspace, because the closure is resolved from
 * one: `pnpm-workspace.yaml` defines the package set, each `package.json`
 * carries the dependency edges, and `bank.paths.json` carries the bundles and
 * the exclusions ([ADR 0039](../../../../../docs/adr/0039-the-selection-is-the-contract.md)).
 *
 * The graph is small but has every shape the resolver has to handle: a package
 * with a workspace dependency (`@acme/db` → `@acme/logger` → the eslint config),
 * one declaring `acme.infra`, an app that the exclusions keep off the menu, a
 * bundle that is always included next to three that are chosen, and one of
 * those (`agents`) naming a nested *file* rather than a directory, the way the
 * real inventory names `.claude/settings.json`.
 *
 * The consumer gets its own file, the scripts vendored under `scripts/`, and a
 * manifest naming a selection — unless `manifest: false`, which is the
 * never-synced state `setup:wizard` runs in.
 */
export function setup({
  packages = ['@acme/eslint-config', '@acme/prettier-config'],
  bundles = [],
  omit = [],
  contributable = [],
  manifest = true,
}: SetupOptions = {}): Sandbox {
  const root = mkdtempSync(join(tmpdir(), 'bank-sandbox-'));
  sandboxes.push(root);
  const bank = join(root, 'bank');
  const consumer = join(root, 'consumer');

  mkdirSync(bank);
  git(bank, ['init', '-q', '-b', 'main']);
  write(
    bank,
    'pnpm-workspace.yaml',
    ['packages:', '  - apps/*', '  - packages/*', '  - tooling/*', ''].join(
      '\n',
    ),
  );
  write(
    bank,
    'bank.paths.json',
    `${JSON.stringify(
      {
        version: 1,
        bundles: [
          {
            name: 'root',
            alwaysIncluded: true,
            paths: ['turbo.json', 'pnpm-workspace.yaml'],
          },
          { name: 'docs', paths: ['docs'] },
          { name: 'agents', paths: ['.claude/settings.json'] },
          { name: 'infra', paths: ['deploy'] },
        ],
        exclude: [
          { path: 'apps', reason: "An app is the consumer's own." },
          {
            path: 'bank.paths.json',
            reason: 'Read at the bank ref, never off the consumer’s disk.',
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  write(bank, 'turbo.json', '{ "tasks": {} }\n');
  write(bank, 'docs/guide.md', '# bank\n');
  write(bank, '.claude/settings.json', '{ "permissions": {} }\n');
  write(bank, '.claude/skills/generated.md', '# regenerated on postinstall\n');
  write(bank, 'deploy/compose.yaml', 'services: {}\n');
  writePackage(
    bank,
    'tooling/eslint',
    { name: '@acme/eslint-config', version: '0.0.0' },
    numberedLines('bank first', 'bank last'),
  );
  writePackage(
    bank,
    'tooling/prettier',
    { name: '@acme/prettier-config', version: '0.0.0' },
    'export default {};\n',
  );
  writePackage(bank, 'packages/logger', {
    name: '@acme/logger',
    version: '0.0.0',
    devDependencies: { '@acme/eslint-config': 'workspace:*' },
  });
  writePackage(bank, 'packages/db', {
    name: '@acme/db',
    version: '0.0.0',
    dependencies: { '@acme/logger': 'workspace:*', postgres: 'catalog:' },
    acme: { infra: ['postgres'] },
  });
  writePackage(bank, 'apps/web', {
    name: '@acme/web',
    version: '0.0.0',
    dependencies: { '@acme/db': 'workspace:*' },
  });
  commit(bank, 'bank: initial');

  mkdirSync(consumer);
  git(consumer, ['init', '-q', '-b', 'main']);
  for (const source of scriptSources) {
    const target = join(consumer, source);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(repoRoot, source), target);
  }
  if (manifest) {
    write(
      consumer,
      'bank.manifest.json',
      `${JSON.stringify(
        { upstream: bank, ref: 'main', packages, bundles, omit, contributable },
        null,
        2,
      )}\n`,
    );
  }
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
