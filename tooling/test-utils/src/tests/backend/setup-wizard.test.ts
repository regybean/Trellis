/**
 * Verifies `scripts/setup-wizard.mjs` — the command that authors a consumer's
 * `bank.manifest.json` from a selection ([#289](https://github.com/regybean/Trellis/issues/289)).
 *
 * Two seams. The command run non-interactively, asserted on the manifest it
 * produced: that file is the contract — it is what a human reads and the only
 * thing `bank:sync` consumes — so nothing here asserts on how the selection was
 * collected. And the offer and the closure preview
 * ([#291](https://github.com/regybean/Trellis/issues/291)), which are what the
 * picker and `--list` render and the only place either could be wrong about
 * what the bank holds.
 *
 * The picker itself is a shell over both and is deliberately untested: arrow
 * keys and raw mode need a pty, and what a test could reach through one is
 * whether node redraws a menu. What it must not do — write anything before the
 * review, or open at all with no terminal to open on — is asserted here.
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
  commit,
  derive,
  git,
  read,
  runScript,
  setup,
  sync,
  treePaths,
  writePackage,
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

/** What `bankOffer` derives — what the menu and `--list` both render. */
interface Offer {
  layers: { layer: string; packages: { name: string; path: string }[] }[];
  bundles: { name: string; description: string; alwaysIncluded: boolean }[];
}

/** What `closurePreview` derives — what the menu redraws under the rows. */
interface Preview {
  pulled: { name: string; path: string; layer: string; reasons: string[] }[];
  infra: boolean;
}

/**
 * `--list` output as its headings, each mapped to the names listed under it —
 * the grouping is the point, so it is read back rather than string-matched.
 */
function grouped(stdout: string) {
  const sections = new Map<string, string[]>();
  let heading = '';
  for (const line of stdout.split('\n')) {
    if (line.trim() === '') continue;
    if (!line.startsWith(' ')) {
      heading = line.trim();
      sections.set(heading, []);
      continue;
    }
    const [name] = line.trim().split(/\s+/);
    if (name) sections.get(heading)?.push(name);
  }
  return sections;
}

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

describe('the offer at a ref', () => {
  it('groups every selectable package by the workspace layer it sits in', () => {
    const sandbox = fresh();

    const offer = derive<Offer>(sandbox, 'main', 'offer');

    // Layer order is the order `pnpm-workspace.yaml` declares its globs, and
    // `apps/*` is absent entirely: the bank's `exclude` takes it out, so a menu
    // built from this can never offer a package the sync would refuse.
    expect(
      offer.layers.map(({ layer, packages }) => [
        layer,
        packages.map((pkg) => pkg.name),
      ]),
    ).toEqual([
      ['packages', ['@acme/db', '@acme/logger']],
      ['tooling', ['@acme/eslint-config', '@acme/prettier-config']],
    ]);
  });

  it('carries each package to its path, and each bundle to its description', () => {
    const sandbox = fresh();

    const offer = derive<Offer>(sandbox, 'main', 'offer');

    expect(offer.layers[0]?.packages[0]).toMatchObject({
      name: '@acme/db',
      path: 'packages/db',
    });
    // `alwaysIncluded` is read here rather than through a second entry point
    // beside it — it is what tells whatever authors a manifest that naming
    // `root` records a choice nobody made.
    expect(offer.bundles).toEqual([
      {
        name: 'root',
        description: 'The workspace itself.',
        alwaysIncluded: true,
      },
      {
        name: 'docs',
        description: 'The guide. Everything a reader needs.',
        alwaysIncluded: false,
      },
      { name: 'agents', description: '', alwaysIncluded: false },
      {
        name: 'infra',
        description: 'The local dev stack.',
        alwaysIncluded: false,
      },
    ]);
  });

  it('follows a package renamed and moved upstream, with no list to edit', () => {
    const sandbox = fresh();
    git(sandbox.bank, ['rm', '-r', '-q', 'packages/db']);
    writePackage(sandbox.bank, 'packages/store', {
      name: '@acme/store',
      version: '0.0.0',
      dependencies: { '@acme/logger': 'workspace:*' },
    });
    commit(sandbox.bank, 'bank: rename @acme/db to @acme/store');

    const offer = derive<Offer>(sandbox, 'main', 'offer');

    expect(offer.layers[0]?.packages).toEqual([
      expect.objectContaining({ name: '@acme/logger' }),
      expect.objectContaining({ name: '@acme/store', path: 'packages/store' }),
    ]);
  });
});

describe('the closure preview', () => {
  it('names, per package pulled in, the selection that required it', () => {
    const sandbox = fresh();

    const preview = derive<Preview>(
      sandbox,
      'main',
      "closurePreview(offer, ['@acme/db'])",
    );

    // Selecting one package visibly brings its closure: `@acme/logger`
    // directly, and the eslint config behind that.
    expect(preview.pulled).toEqual([
      {
        name: '@acme/eslint-config',
        path: 'tooling/eslint',
        layer: 'tooling',
        reasons: ['@acme/db'],
      },
      {
        name: '@acme/logger',
        path: 'packages/logger',
        layer: 'packages',
        reasons: ['@acme/db'],
      },
    ]);
  });

  it('credits every selection that reaches a shared dependency', () => {
    const sandbox = fresh();

    const preview = derive<Preview>(
      sandbox,
      'main',
      "closurePreview(offer, ['@acme/db', '@acme/logger'])",
    );

    // A package chosen outright is not "pulled in", and the one behind both
    // names both — a single visited-set walk would credit whichever got there
    // first and quietly drop the other.
    expect(preview.pulled).toEqual([
      expect.objectContaining({
        name: '@acme/eslint-config',
        reasons: ['@acme/db', '@acme/logger'],
      }),
    ]);
  });

  it('reports the infra bundle as selected when the closure declares it', () => {
    const sandbox = fresh();

    // `@acme/db` declares `acme.infra`; `@acme/logger`'s closure does not.
    expect(
      derive<Preview>(sandbox, 'main', "closurePreview(offer, ['@acme/db'])")
        .infra,
    ).toBe(true);
    expect(
      derive<Preview>(
        sandbox,
        'main',
        "closurePreview(offer, ['@acme/logger'])",
      ).infra,
    ).toBe(false);
  });
});

describe('setup:wizard --list', () => {
  it('prints the offer grouped by layer and writes nothing', () => {
    const { bank, consumer } = fresh();

    const run = runScript(consumer, WIZARD, [
      '--list',
      '--upstream',
      bank,
      '--ref',
      'main',
    ]);

    expect(run.status).toBe(0);
    const sections = grouped(run.stdout);
    expect(sections.get('packages/')).toEqual(['@acme/db', '@acme/logger']);
    expect(sections.get('tooling/')).toEqual([
      '@acme/eslint-config',
      '@acme/prettier-config',
    ]);
    expect(sections.get('bundles')).toEqual([
      'root',
      'docs',
      'agents',
      'infra',
    ]);
    expect(run.stdout).toContain('always included');
    expect(() => read(consumer, 'bank.manifest.json')).toThrow();
  });

  it('needs the ref it lists at', () => {
    const { bank, consumer } = fresh();

    const run = runScript(consumer, WIZARD, ['--list', '--upstream', bank]);

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('--ref');
  });
});

describe('setup:wizard with no arguments', () => {
  it('refuses without a terminal to open the picker on, naming the flag form', () => {
    const { consumer } = fresh();

    // Spawned with pipes, which is CI and every scripted run: there is nothing
    // to drive a menu with, and half a menu in a pipe helps nobody.
    const run = runScript(consumer, WIZARD, []);

    expect(run.status).not.toBe(0);
    expect(run.stdout).toBe('');
    expect(run.stderr).toContain('no terminal');
    expect(run.stderr).toContain('--upstream');
    expect(() => read(consumer, 'bank.manifest.json')).toThrow();
  });
});
