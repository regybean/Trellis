/**
 * The constraint that shapes this whole package: the bank runs *before*
 * `pnpm install`, in a repo that has received only what a bundle put there.
 *
 * A consumer's first contact with the bank is hand-copying four files into a
 * repo with no `node_modules`, then running the wizard and the first sync with
 * bare `node` ([docs/bank.md](../../../../../docs/bank.md), and
 * [ADR 0001](../../../docs/adr/0001-the-bank-keeps-its-own-workspace-helpers.md)
 * for why the duplication that follows from it is deliberate). There is no
 * module resolution at that point, so a single bare specifier — a shared
 * helper, a YAML parser, anything from the workspace — breaks the bootstrap for
 * every new consumer while leaving this repo, where everything is installed,
 * perfectly green.
 *
 * The three rules below it are the same failure a layer out: root
 * `package.json` is itself always-included content, so a consumer receives our
 * script entries and our workspace whether or not they receive what those
 * entries invoke, what that content declares, and what its file bodies import.
 *
 * Always-included is several bundles rather than one, split by subject — which
 * is why every rule below derives the delivered set from the `alwaysIncluded`
 * flag across all of them and never from a bundle name.
 *
 * All four are silent by construction in a repo where everything is present,
 * which is why they are tests rather than comments.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
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
 * The three rules below are claims about *this* repo's bundles, and the
 * inventory has no generic substitute: a consumer's always-included set is
 * whatever their own bank decided, and with no inventory there is no set to
 * derive at all. So they skip in a repo that is not a bank, naming the content
 * the claim wanted, rather than failing on a file a consumer was never sent.
 * Everything above this line is about the package's own source and holds
 * anywhere.
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

/**
 * What keeps the derivation above honest.
 *
 * The required set is several bundles, each holding one argument for why its
 * paths are required. A rule that named one of them instead of reading the flag
 * would go quiet the moment a path moved to a sibling, and would pass having
 * checked a fraction of the set. So the claim here is that more than one bundle
 * carries the flag, which is what stops reading it across all of them from
 * being a longer spelling of one name.
 */
describeBank('the required set is several bundles, read by flag', () => {
  const required = recordList(readJson(inventory), 'bundles').filter(
    (bundle) => bundle.alwaysIncluded === true,
  );

  it('is split across bundles, so reading the flag is not one name spelled out', () => {
    expect(required.length).toBeGreaterThan(1);
  });

  it.each(required.map((bundle) => stringField(bundle, 'name') ?? ''))(
    '%s says why its paths are required',
    (name) => {
      const bundle = required.find(
        (entry) => stringField(entry, 'name') === name,
      );

      expect(
        stringField(bundle ?? {}, 'description')?.length ?? 0,
        `bundle "${name}" is required and carries no argument for it — the flag says a consumer cannot decline these paths, and nothing else says why`,
      ).toBeGreaterThan(0);
    },
  );
});

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
 * Derived from the manifests rather than a list here, so it kept holding as the
 * rest of `scripts/` moved into tooling packages.
 */
describeBank(
  'every delegated tooling command arrives with the always-included bundles',
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
 * `pnpm-workspace.yaml` is always-included content too, which means the consumer's
 * install resolves that manifest whether they wanted the package or not. One
 * unreachable `workspace:*` and `pnpm install` fails outright, in a repo whose
 * selection was otherwise perfectly legitimate.
 *
 * A bundles-only selection is exactly that: "give me the scaffolding, none of
 * the packages". It is the case no real selection exercises, because any real
 * package pulls the config packages in through its own closure.
 */
describeBank(
  'a package an always-included bundle delivers arrives with what it declares',
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

/**
 * Why the root manifest is exempt from the filter half of the rule below.
 *
 * Printed under a failure, so the reader of the exception meets the argument
 * for it at the moment they are about to add one. The argument itself is not
 * restated here — it is the dangling-entry section of the bank's own doc,
 * `docs/bank.md`, and the decision behind it is on record as an ADR.
 */
const DANGLING_IS_THE_CONSUMERS_TO_DELETE = `
A root \`package.json\` script entry is exempt: it is one line the consumer
deletes, and the bank's dangling-entry table names each one. A script *body*
is not — there is no line to delete inside one, so derive the target instead.
See the dangling-entry section of \`docs/bank.md\`.
`.trim();

/** Extensions whose text can carry an import. */
const IMPORTING = new Set([
  'ts',
  'tsx',
  'mts',
  'cts',
  'js',
  'jsx',
  'mjs',
  'cjs',
]);

/** Extensions whose text can carry a `source`. */
const SOURCING = new Set(['sh', 'bash', 'zsh']);

/**
 * The literal tail of a specifier, or `undefined` when there is not one.
 *
 * `"$script_dir/lib/dev-logs.sh"` names `lib/dev-logs.sh` relative to the
 * script — the variable is how a shell script says "next to me", and the tail
 * is the part that names a file. `"$adapter"` and `"$(dirname …)"` name nothing
 * a reader of the text can resolve, and a rule that guessed at them would be
 * inventing the finding.
 */
function literalTail(raw: string) {
  const specifier = raw.replace(/^["']|["']$/g, '');
  if (specifier.includes('$(')) return undefined;
  if (!specifier.includes('$')) return specifier;
  const afterBrace = specifier.slice(specifier.lastIndexOf('}') + 1);
  const tail = afterBrace.replace(/^\$\w+/, '').replace(/^\//, '');
  return tail === '' ? undefined : tail;
}

/**
 * The third invariant, and the one that generalises the other two: a file an
 * always-included bundle delivers may not reach for content no always-included
 * bundle delivers.
 *
 * The two rules above each catch one shape of that failure — a manifest key
 * calling a package the consumer never got, a manifest declaring a
 * `workspace:*` on one. This is the shape a *file body* has: a root script
 * sourcing a sibling, the feature seed reaching into the generators, the
 * agent-doc linker, a vendored suite importing a fixture. One rule over all of
 * them, derived from the same `alwaysIncluded` bundles, is why none of those
 * needs a preflight that materialises a tree and tries it.
 *
 * Two reaches count, because those are the two that cannot be guarded:
 *
 *   1. **A relative import.** `import './x'`, `require('./x')`, `source ./x` —
 *      resolved before a line of the file runs, so an absent target is a hard
 *      failure with no branch left to take.
 *   2. **A package filter** in a command the file runs: `--filter @acme/x`,
 *      `pnpm -C <dir>`.
 *
 * A path merely *named* is not a reach. `link-agent-docs.sh` and
 * `register-skills.sh` both name content the `agents` bundle carries and both
 * exit 0 when it is absent, which is the correct handling — and the reason this
 * rule asks about imports rather than mentions.
 */
describeBank(
  'a delivered file reaches only for what the always-included bundles deliver',
  () => {
    const files = execFileSync(
      'git',
      ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      { cwd: repoRoot, encoding: 'utf8' },
    )
      .split('\0')
      .filter(Boolean)
      .filter((file) => delivered(file))
      // A symlink's body is its target's, already read under its own path.
      .filter((file) => !lstatSync(join(repoRoot, file)).isSymbolicLink())
      .sort();

    const extensionOf = (file: string) =>
      file.split('.').pop()?.toLowerCase() ?? '';

    /** Every relative import a delivered file makes, as the path it resolves to. */
    const imports = files.flatMap((file) => {
      const extension = extensionOf(file);
      if (!IMPORTING.has(extension) && !SOURCING.has(extension)) return [];
      const source = readFileSync(join(repoRoot, file), 'utf8');

      const specifiers = IMPORTING.has(extension)
        ? [
            // Line-anchored, because a negated class matches newlines too: an
            // unanchored one runs from an `import` past the end of its
            // statement and captures the next quoted thing in the file. And
            // `from` is required, so `export const x = '../..'` is a value
            // rather than a specifier.
            ...source.matchAll(
              /^(?:import|export)\s[^'"\n]*\bfrom\s*['"]([^'"\n]+)['"]/gm,
            ),
            ...source.matchAll(/^import\s*['"]([^'"\n]+)['"]/gm),
            ...source.matchAll(/\bimport\(\s*['"]([^'"\n]+)['"]\s*\)/g),
            ...source.matchAll(/\brequire\(\s*['"]([^'"\n]+)['"]\s*\)/g),
          ]
            .flatMap((match) => match[1] ?? [])
            .filter((specifier) => specifier.startsWith('.'))
        : [...source.matchAll(/^\s*(?:source|\.)\s+(\S+)/gm)].flatMap(
            (match) => match[1] ?? [],
          );

      return specifiers.flatMap((specifier) => {
        const tail = literalTail(specifier);
        if (tail === undefined || tail.startsWith('/')) return [];
        const target = posix.normalize(posix.join(posix.dirname(file), tail));
        return [{ file, specifier, target }];
      });
    });

    /**
     * The package directories a text runs a command against.
     *
     * `--filter @acme/x` resolves through the graph, because the name is what
     * the text carries and the directory is what a bundle delivers; `pnpm -C`
     * already names a directory. A filter naming a package this workspace does
     * not have resolves to nothing and drops out, which is the right answer for
     * a command aimed at something no selection could deliver either.
     */
    const filtersIn = (text: string) => [
      ...[...text.matchAll(/--filter[= ]"?(@[\w-]+\/[\w-]+)/g)].flatMap(
        (match) => packages.get(match[1] ?? '')?.dir ?? [],
      ),
      ...[...text.matchAll(/\bpnpm\s+-C\s+([\w./-]+)/g)].flatMap(
        (match) => match[1] ?? [],
      ),
    ];

    /**
     * Every literal package filter, in the files that can actually run one.
     *
     * Two kinds of file are skipped, for two unrelated reasons:
     *
     *   - `package.json`, which does run its commands — exempt by the argument
     *     in `DANGLING_IS_THE_CONSUMERS_TO_DELETE`, and the one exemption
     *     `docs/bank.md` sanctions.
     *   - Markdown, which runs nothing. A command in prose is an example, and a
     *     doc naming a selectable package is a dangling *pointer*, which the
     *     doc rules already govern — not a reach that fails at runtime.
     */
    const filters = files
      .filter((file) => file !== 'package.json' && extensionOf(file) !== 'md')
      .flatMap((file) =>
        filtersIn(readFileSync(join(repoRoot, file), 'utf8')).map((dir) => ({
          file,
          dir,
        })),
      );

    it('finds imports to judge, so the rule is not vacuous', () => {
      expect(imports.length).toBeGreaterThan(0);
      expect(imports.some(({ target }) => delivered(target))).toBe(true);
    });

    it('has something to withhold, so `delivered` is not constantly true', () => {
      // A repo whose every bundle were always-included would pass all three
      // rules by construction and prove nothing about any of them. Overlap is
      // allowed and real — the agents bundle names two scripts the `commands`
      // bundle already covers, so a consumer who takes it gets them either way
      // — so the claim is that *some* bundle path is withheld, not every one.
      const optional = recordList(readJson(inventory), 'bundles')
        .filter((bundle) => bundle.alwaysIncluded !== true)
        .flatMap((bundle) => stringList(bundle, 'paths'));

      expect(
        optional.filter((path) => !delivered(path)).length,
      ).toBeGreaterThan(0);
    });

    it('exempts a root manifest that really does name what the minimum lacks', () => {
      // The same extraction over the one file the filter half skips. It names
      // packages a minimum selection never delivers — so the skip is the
      // decision `DANGLING_IS_THE_CONSUMERS_TO_DELETE` argues for, not an
      // oversight, and this is what fails if the exemption stops mattering.
      const dangling = filtersIn(Object.values(rootScripts).join('\n')).filter(
        (dir) => !delivered(dir),
      );

      expect(dangling.length).toBeGreaterThan(0);
    });

    it.each(imports)(
      '$file imports $specifier, and an always-included bundle delivers it',
      ({ file, specifier, target }) => {
        expect(
          delivered(target),
          `${file} imports ${specifier}, resolving to ${target}, which no always-included bundle delivers — a consumer whose selection stopped at the minimum would fail on the first line of ${file}`,
        ).toBe(true);
      },
    );

    it.each(filters)(
      '$file filters on $dir, and an always-included bundle delivers it',
      ({ file, dir }) => {
        expect(
          delivered(dir),
          `${file} runs a command filtered on ${dir}, which no always-included bundle delivers — and unlike a root package.json entry there is no line for a consumer to delete.\n\n${DANGLING_IS_THE_CONSUMERS_TO_DELETE}`,
        ).toBe(true);
      },
    );
  },
);
