/**
 * Verifies `scripts/setup-wizard.mjs` — the command that authors a consumer's
 * `bank.manifest.json` from a selection ([#289](https://github.com/regybean/Trellis/issues/289)).
 *
 * One seam: the command run non-interactively, asserted on the manifest it
 * produced. That file is the contract — it is what a human reads and the only
 * thing `bank:sync` consumes — so nothing here asserts on how the selection was
 * collected. The interactive picker is a shell over this same path and is
 * deliberately untested.
 *
 * The strongest assertion available is that the manifest drives a real sync, so
 * the first case does exactly that: wizard, then `bank-sync.mjs`, in the same
 * sandbox. Sandbox and script-vendoring live in `./bank-sandbox`, shared with
 * the two bank suites.
 *
 * No container is needed here. The suite's global-setup starts LocalStack for
 * the sibling secrets test; this file uses none of it.
 */

import { afterEach, describe, expect, it } from 'vitest';

import type { Run } from './bank-sandbox';
import {
  cleanupSandboxes,
  read,
  runScript,
  setup,
  sync,
  treePaths,
} from './bank-sandbox';

afterEach(cleanupSandboxes);

const WIZARD = 'scripts/setup-wizard.mjs';

interface Selection {
  upstream: string;
  ref?: string;
  packages?: string[];
  bundles?: string[];
  extra?: string[];
}

/** The argument form a scripted setup uses. */
function args({
  upstream,
  ref = 'main',
  packages,
  bundles,
  extra = [],
}: Selection) {
  return [
    '--upstream',
    upstream,
    '--ref',
    ref,
    ...(packages ? ['--packages', packages.join(',')] : []),
    ...(bundles ? ['--bundles', bundles.join(',')] : []),
    ...extra,
  ];
}

function wizard(consumer: string, selection: Selection): Run {
  return runScript(consumer, WIZARD, args(selection));
}

/** Runs the wizard expecting success, returning the manifest it wrote. */
function author(consumer: string, selection: Selection) {
  const run = wizard(consumer, selection);
  if (run.status !== 0)
    throw new Error(`expected setup:wizard to succeed: ${run.stderr}`);
  return JSON.parse(read(consumer, 'bank.manifest.json')) as Record<
    string,
    unknown
  >;
}

/** Runs the wizard expecting a refusal, returning its exit code and stderr. */
function refusal(consumer: string, selection: Selection) {
  const run = wizard(consumer, selection);
  if (run.status === 0)
    throw new Error('expected setup:wizard to fail, but it succeeded');
  return run;
}

/** A consumer that has never synced, which is where the wizard runs. */
const fresh = () => setup({ manifest: false });

describe('setup:wizard authors a manifest', () => {
  it('writes the six manifest fields, and bank:sync then succeeds against it', () => {
    const { bank, consumer } = fresh();

    const manifest = author(consumer, {
      upstream: bank,
      packages: ['@acme/db'],
      bundles: ['docs'],
    });

    expect(manifest).toEqual({
      upstream: bank,
      ref: 'main',
      packages: ['@acme/db'],
      bundles: ['docs'],
      omit: [],
      contributable: [],
    });

    // The property that actually matters: the file it wrote is a manifest the
    // sync can resolve. `@acme/db` pulls its closure and, declaring acme.infra,
    // the infra bundle with it.
    sync(consumer);
    expect(treePaths(consumer, 'vendor/trellis')).toEqual([
      'deploy/compose.yaml',
      'docs/guide.md',
      'packages/db/index.js',
      'packages/db/package.json',
      'packages/logger/index.js',
      'packages/logger/package.json',
      'pnpm-workspace.yaml',
      'tooling/eslint/index.js',
      'tooling/eslint/package.json',
      'turbo.json',
    ]);
  });

  it('records only the names given, leaving the closure to the sync', () => {
    const { bank, consumer } = fresh();

    const manifest = author(consumer, {
      upstream: bank,
      packages: ['@acme/db'],
    });

    // @acme/db's closure is three packages, but expanding it here would
    // snapshot it at authoring time — exactly what ADR 0039 removed.
    expect(manifest.packages).toEqual(['@acme/db']);
  });

  it('leaves omit and contributable empty, and never writes the root bundle', () => {
    const { bank, consumer } = fresh();

    const manifest = author(consumer, {
      upstream: bank,
      packages: ['@acme/logger'],
      bundles: ['root', 'docs'],
    });

    // `root` cannot be opted out of, so recording it would imply it was a
    // choice. Back-flow stays a decision a human makes, so `contributable`
    // is never seeded.
    expect(manifest.bundles).toEqual(['docs']);
    expect(manifest.omit).toEqual([]);
    expect(manifest.contributable).toEqual([]);
  });

  it('gives a working base for the empty selection', () => {
    const { bank, consumer } = fresh();

    const manifest = author(consumer, { upstream: bank });

    expect(manifest.packages).toEqual([]);
    expect(manifest.bundles).toEqual([]);
    sync(consumer);
    // The always-included `root` bundle alone — a repo taking the workspace
    // and no slice at all still syncs.
    expect(treePaths(consumer, 'vendor/trellis')).toEqual([
      'pnpm-workspace.yaml',
      'turbo.json',
    ]);
  });
});

describe('setup:wizard refuses before it writes', () => {
  it('names a package that does not exist at the ref, and writes nothing', () => {
    const { bank, consumer } = fresh();

    const run = refusal(consumer, {
      upstream: bank,
      packages: ['@acme/db', '@acme/nope'],
    });

    expect(run.stderr).toContain('@acme/nope');
    expect(() => read(consumer, 'bank.manifest.json')).toThrow();
  });

  it('names a bundle that does not exist at the ref, and writes nothing', () => {
    const { bank, consumer } = fresh();

    const run = refusal(consumer, { upstream: bank, bundles: ['telemetry'] });

    expect(run.stderr).toContain('telemetry');
    expect(() => read(consumer, 'bank.manifest.json')).toThrow();
  });

  it('refuses an unreachable ref', () => {
    const { bank, consumer } = fresh();

    const run = refusal(consumer, { upstream: bank, ref: 'bank/2000-01-01' });

    expect(run.stderr).toContain('bank/2000-01-01');
    expect(() => read(consumer, 'bank.manifest.json')).toThrow();
  });

  it('refuses to overwrite a manifest that is already there', () => {
    // The default sandbox consumer already has one, pinning two packages.
    const { bank, consumer } = setup();
    const before = read(consumer, 'bank.manifest.json');

    const run = refusal(consumer, { upstream: bank, packages: ['@acme/db'] });

    expect(run.stderr).toContain('bank.manifest.json');
    expect(read(consumer, 'bank.manifest.json')).toBe(before);
  });

  it('overwrites only when told to', () => {
    const { bank, consumer } = setup();

    const manifest = author(consumer, {
      upstream: bank,
      packages: ['@acme/db'],
      extra: ['--force'],
    });

    expect(manifest.packages).toEqual(['@acme/db']);
  });

  it('replaces the selection on --force but keeps omit and contributable', () => {
    const { bank, consumer } = setup({
      packages: ['@acme/db'],
      omit: ['packages/logger'],
      contributable: ['packages/db'],
    });

    const manifest = author(consumer, {
      upstream: bank,
      packages: ['@acme/logger'],
      extra: ['--force'],
    });

    // A selection passed as arguments says nothing about either field, and both
    // are maintained by hand — an allowlist reviewed path by path especially.
    // Resetting them would be a silent loss on a re-run.
    expect(manifest.packages).toEqual(['@acme/logger']);
    expect(manifest.omit).toEqual(['packages/logger']);
    expect(manifest.contributable).toEqual(['packages/db']);
  });

  it('names an argument it does not understand', () => {
    const { bank, consumer } = fresh();

    const run = refusal(consumer, {
      upstream: bank,
      extra: ['--include', 'x'],
    });

    expect(run.stderr).toContain('--include');
    expect(() => read(consumer, 'bank.manifest.json')).toThrow();
  });
});
