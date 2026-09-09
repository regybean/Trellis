/**
 * The constraint that shapes this whole package: the bank runs *before*
 * `pnpm install`, in a repo that has received only what a bundle put there.
 *
 * A consumer's first contact with Trellis is hand-copying four files into a
 * repo with no `node_modules`, then running the wizard and the first sync with
 * bare `node` ([docs/bank.md](../../../../../docs/bank.md), and
 * [ADR 0001](../../../docs/adr/0001-the-bank-keeps-its-own-workspace-helpers.md)
 * for why the duplication that follows from it is deliberate). There is no
 * module resolution at that point, so a single bare specifier — a shared
 * helper, a YAML parser, anything from the workspace — breaks the bootstrap for
 * every new consumer while leaving this repo, where everything is installed,
 * perfectly green.
 *
 * The two rules below it are the same failure a layer out: root `package.json`
 * is itself `root`-bundle content, so a consumer receives our script entries
 * and our workspace whether or not they receive what those entries invoke and
 * what that content declares.
 *
 * All three are silent by construction in a repo where everything is present,
 * which is why they are tests rather than comments.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  readJson,
  recordList,
  stringField,
  stringList,
  stringMap,
} from './json';

const here = dirname(fileURLToPath(import.meta.url));
// src/tests/backend -> the package's src is two levels up.
const src = resolve(here, '../../');
// ...and the repo root five.
const repoRoot = resolve(here, '../../../../../');

/**
 * Every runtime file in the package.
 *
 * Four of them are the hand-copy set (docs/bank.md, step 1); `bank-contribute`
 * and the two checkers arrive with the first sync. All seven are checked,
 * because the two libs are shared and a bare specifier in either breaks the
 * pair that bootstraps.
 */
const sources = [
  'bank-sync.mjs',
  'bank-contribute.mjs',
  'setup-wizard.mjs',
  'check-bank-paths.mjs',
  'check-bank-tokens.mjs',
  'lib/bank.mjs',
  'lib/bank-closure.mjs',
];

/**
 * Every module specifier a file imports, static or dynamic. Deliberately a
 * regex over the source rather than a parse: the thing being checked is the
 * literal text a consumer copies, and a bare specifier is visible in it.
 */
function specifiers(file: string) {
  const source = readFileSync(join(src, file), 'utf8');

  return [
    ...source.matchAll(/^import\s[^'"]*['"]([^'"]+)['"]/gm),
    ...source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g),
    ...source.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g),
  ].flatMap((match) => match[1] ?? []);
}

describe('the bank depends on nothing that needs installing', () => {
  it.each(sources)(
    '%s imports only node builtins and its own siblings',
    (file) => {
      const offending = specifiers(file).filter(
        (specifier) =>
          !specifier.startsWith('node:') && !specifier.startsWith('./'),
      );

      expect(
        offending,
        `${file} imports ${offending.join(', ')} — a consumer runs this with bare node before any install, so there is nothing to resolve it against`,
      ).toEqual([]);
    },
  );

  it('imports at least one builtin and one sibling, so the rule is not vacuous', () => {
    const all = sources.flatMap(specifiers);

    expect(all.filter((s) => s.startsWith('node:')).length).toBeGreaterThan(0);
    expect(all.filter((s) => s.startsWith('./')).length).toBeGreaterThan(0);
  });
});

interface WorkspacePackage {
  name: string;
  dir: string;
  workspaceDependencies: string[];
}

/**
 * Every workspace package, by name, with the sibling packages it declares a
 * `workspace:` dependency on.
 *
 * `--others --exclude-standard` alongside the index, so a package added in the
 * working tree counts before it is committed — otherwise the rules below
 * silently skip exactly the package a move is in the middle of introducing.
 * Ignored paths stay out, which is what keeps `node_modules` from being walked.
 */
const packages = new Map<string, WorkspacePackage>(
  execFileSync(
    'git',
    [
      'ls-files',
      '-z',
      '--cached',
      '--others',
      '--exclude-standard',
      '*/package.json',
    ],
    { cwd: repoRoot, encoding: 'utf8' },
  )
    .split('\0')
    .filter(Boolean)
    .flatMap((manifest): [string, WorkspacePackage][] => {
      const parsed = readJson(join(repoRoot, manifest));
      const name = stringField(parsed, 'name');
      if (name === undefined) return [];

      const workspaceDependencies = Object.entries({
        ...stringMap(parsed, 'dependencies'),
        ...stringMap(parsed, 'devDependencies'),
        ...stringMap(parsed, 'peerDependencies'),
      })
        .filter(([, range]) => range.startsWith('workspace:'))
        .map(([dependency]) => dependency);

      return [[name, { name, dir: dirname(manifest), workspaceDependencies }]];
    }),
);

/**
 * The bank's own inventory — which `exclude` keeps out of every sync, so it is
 * present here and absent in every consumer.
 *
 * The two rules below are claims about *this* repo's bundles, and the inventory
 * has no generic substitute: a consumer's always-included set is whatever their
 * own bank decided, and with no inventory there is no set to derive at all. So
 * they skip in a repo that is not a bank, naming the content the claim wanted,
 * rather than failing on a file a consumer was never sent. Everything above
 * this line is about the package's own source and holds anywhere.
 */
const inventory = join(repoRoot, 'bank.paths.json');
const isBank = existsSync(inventory);
const NEEDS_INVENTORY =
  "skipped: needs bank.paths.json, the bank's own inventory, to derive the always-included bundles from — this repo is not a bank";

/** A describe that names the content it wanted when it skips. */
function describeBank(name: string, suite: () => void) {
  describe.skipIf(!isBank)(
    isBank ? name : `${name} — ${NEEDS_INVENTORY}`,
    suite,
  );
}

/** The path prefixes every selection receives, whatever it asked for. */
const alwaysIncluded = isBank
  ? recordList(readJson(inventory), 'bundles')
      .filter((bundle) => bundle.alwaysIncluded === true)
      .flatMap((bundle) => stringList(bundle, 'paths'))
  : [];

/** Does an always-included bundle deliver this directory? */
const delivered = (dir: string) =>
  alwaysIncluded.some(
    (prefix) => dir === prefix || dir.startsWith(`${prefix}/`),
  );

const rootScripts = stringMap(
  readJson(join(repoRoot, 'package.json')),
  'scripts',
);

/**
 * A root command delegated into a **tooling** package has to name a package
 * that arrives with an always-included bundle — otherwise a consumer whose
 * manifest never selected it syncs a `package.json` calling a package it does
 * not have. For the bank the first casualty is the command that performs their
 * next sync, which is why this is a test and not a comment.
 *
 * Scoped to `tooling/` deliberately. The root also carries a few conveniences
 * that delegate into feature packages (`studio`, `seed:localstripe`,
 * `lint:mastra`); those name content a consumer chooses, and a selection that
 * omits the feature is meant to leave the script dangling rather than drag the
 * whole slice in. A repo *command* is not optional in the same way.
 *
 * Derived from the manifests rather than a list here, so it kept holding as
 * the rest of `scripts/` moved into tooling packages (#314).
 */
describeBank(
  'every delegated tooling command arrives with the root bundle',
  () => {
    /**
     * The package directory each root script delegates into. Both spellings
     * count: `--filter <name>` resolves through the manifests, `-C <dir>` names
     * the directory outright — which is the form the bank uses, for the reason
     * asserted in `bank-sync.test.ts`.
     */
    const delegated = [
      ...new Set(
        Object.values(rootScripts).flatMap((command) => {
          const name = /--filter\s+(@[\w-]+\/[\w-]+)/.exec(command)?.[1];
          if (name !== undefined) return packages.get(name)?.dir ?? [];
          return /\bpnpm\s+-C\s+(\S+)/.exec(command)?.[1] ?? [];
        }),
      ),
    ]
      .sort()
      .filter((dir) => dir.startsWith('tooling/'));

    it('delegates at least the bank commands, so the rule has something to bind', () => {
      expect(delegated).toContain('tooling/bank');
    });

    it.each(delegated)('%s is covered by an always-included bundle', (dir) => {
      expect(
        delivered(dir),
        `root package.json delegates into ${dir}, but no always-included bundle path covers it — a consumer would sync a package.json calling a package it never received`,
      ).toBe(true);
    });
  },
);

/**
 * The same invariant one level down, in the direction bundles cannot see.
 *
 * A bundle contributes **paths**; only a *selected package* has its dependency
 * edges walked. So a package a bundle delivers arrives with its manifest and
 * without the workspace packages that manifest declares — and
 * `pnpm-workspace.yaml` is root-bundle content too, which means the consumer's
 * install resolves that manifest whether they wanted the package or not. One
 * unreachable `workspace:*` and `pnpm install` fails outright, in a repo whose
 * selection was otherwise perfectly legitimate.
 *
 * A bundles-only selection is exactly that: "give me the scaffolding, none of
 * the packages". It is the case no real selection exercises, because any real
 * package pulls the config packages in through its own closure.
 */
describeBank(
  'a package the root bundle delivers arrives with what it declares',
  () => {
    const deliveredPackages = [...packages.values()]
      .filter((pkg) => delivered(pkg.dir))
      .sort((a, b) => a.dir.localeCompare(b.dir));

    it('delivers at least one package, so the rule has something to bind', () => {
      expect(deliveredPackages.map((pkg) => pkg.dir)).toContain('tooling/bank');
    });

    it.each(deliveredPackages)(
      '$dir declares only workspace packages the same bundles deliver',
      ({ name, dir, workspaceDependencies }) => {
        // Transitive: a delivered dependency that itself declares an undelivered
        // one leaves the same broken install one edge further out.
        const seen = new Set([name]);
        const queue = [...workspaceDependencies];
        const missing: string[] = [];

        while (queue.length) {
          const dependency = queue.shift() ?? '';
          if (seen.has(dependency)) continue;
          seen.add(dependency);

          const resolved = packages.get(dependency);
          if (resolved === undefined || !delivered(resolved.dir)) {
            missing.push(dependency);
            continue;
          }
          queue.push(...resolved.workspaceDependencies);
        }

        expect(
          missing,
          `${dir} is delivered by an always-included bundle but declares workspace:* on ${missing.join(', ')}, which no always-included bundle delivers — a consumer whose selection reaches neither would fail pnpm install on an unresolvable dependency`,
        ).toEqual([]);
      },
    );
  },
);
