/**
 * Every external package a package's source imports is named in that package's
 * own manifest.
 *
 * `@acme/db` imported `zod` and declared it nowhere — the defect shipped to a
 * consumer repo and was found by a human reading the manifest. Nothing here
 * caught it, and the three things that look like they should each answer a
 * different question: `deps:lint` is syncpack, which aligns version *ranges*
 * across manifests and never reads an import; `turbo boundaries` reads the
 * workspace graph, so it sees `@acme/*` edges and not external ones; and knip's
 * `unlisted` — the closest fit, already configured — has the exact blind spot
 * that defect fell through. `zod` is an **optional peerDependency of
 * `@t3-oss/env-core`**, which `@acme/db` does declare, and knip counts a peer
 * of a declared dependency as satisfied. Re-running knip with `zod` deleted
 * from the manifest reports nothing.
 *
 * Locally nothing else notices either, because pnpm hoists the whole tree into
 * the root `node_modules` here: an undeclared import resolves fine from inside
 * this repo and only fails once a consumer installs the package on its own.
 * That is what makes this a gate rather than something a human would hit.
 *
 * So the rule is the blunt one, over the manifest rather than the install:
 * scan each package's source for bare import specifiers, map each to the
 * package it names, and require that name to appear in the importing package's
 * own `package.json`.
 *
 * ## What counts as declared
 *
 * Any of {@link DEPENDENCY_FIELDS} — `dependencies`, `devDependencies`,
 * `peerDependencies`, `optionalDependencies`.
 *
 * **A devDependency satisfies any import, including one in runtime source.**
 * That is deliberately looser than it could be. A runtime file importing a
 * devDependency is its own defect, but it is a *misplacement* rather than a
 * missing declaration, and folding the two together would make every failure
 * ambiguous about which one it is. It would also be mostly noise: test files,
 * `vitest.config.*`, `eslint.config.*` and `scripts/` legitimately import
 * devDependencies, and they are the bulk of what the stricter rule reports.
 *
 * **Type-only imports count.** `import type { X } from 'zod'` needs `zod` on
 * disk for a consumer to typecheck, so an undeclared one breaks their build the
 * way a value import breaks their runtime — same defect, later. A failure
 * naming an `import type` line is a real finding, and satisfying it with a
 * devDependency (or a `@types/*` package, which is a declaration like any
 * other) is the normal fix.
 *
 * ## What is out of scope
 *
 * Node builtins, relative and absolute paths, and tsconfig path aliases name no
 * package. Workspace packages are skipped because `turbo boundaries` already
 * fails on an undeclared `@acme/*` edge and knows the layer rules this does not
 * — two gates disagreeing about the same import would be worse than one.
 *
 * ## Suppressions
 *
 * In the importing package's own manifest, naming the import and why:
 *
 *     "acme": {
 *       "undeclaredImports": {
 *         "next": "Resolved from the host app; see ADR ..."
 *       }
 *     }
 *
 * A suppression therefore cannot be written anywhere but the one package it
 * exempts, cannot cover an import it does not name, and cannot be empty — the
 * reason is a required non-empty string, and a suppression the package no
 * longer needs fails the check rather than rotting. There is deliberately no
 * repo-wide equivalent. That is the same bargain the dependency-audit allowlist
 * strikes — a suppression must name the one thing it exempts and say why, so
 * that switching a gate off is never the cheapest way past it.
 */
import { builtinModules } from 'node:module';
import ts from 'typescript';

import type { Violations } from '@acme/workspace-graph';
import { collectViolations } from '@acme/workspace-graph';

import type { PackageIo } from './io';
import { acmeBlock } from './manifest';

/** The manifest fields a declaration may live in. Any of them satisfies. */
export const DEPENDENCY_FIELDS: readonly string[] = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];

/** The `acme` key a package's suppressions live under. */
export const SUPPRESSION_KEY = 'undeclaredImports';

/** The contract, printed under a failure. */
export const IMPORTS_HELP = `Every external package a package's source imports is declared in that package's own package.json (any dependency field). A deliberate exception goes in that package's \`acme.${SUPPRESSION_KEY}\` with a written reason. See tooling/repo-checks/src/imports.ts.`;

/** What the scanner reads. `.d.ts` included: its imports are imports. */
const SOURCE_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
];

const BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Whether this check reads the file at package-relative `rel`. */
export const isSource = (rel: string) =>
  !rel.endsWith('/') && SOURCE_EXTENSIONS.some((ext) => rel.endsWith(ext));

/**
 * The package a specifier names, or `undefined` when it names none.
 *
 * A bare specifier's package name is its first segment, or its first two when
 * scoped — everything after that is a subpath into the same package, which is
 * what makes `zod/v4` a `zod` import. Relative and absolute paths, builtins and
 * the `~/` and `#` alias prefixes name no package and drop out here.
 */
export function specifierPackage(specifier: string): string | undefined {
  if (specifier === '' || BUILTINS.has(specifier)) return undefined;
  // Relative, absolute, alias, and subpath-imports (`#internal`) specifiers.
  if (/^[./~#]/.test(specifier)) return undefined;

  const [first, second] = specifier.split('/');
  if (first === undefined || first === '') return undefined;

  // A scope with no package after it (`@scope`) names nothing.
  if (first.startsWith('@')) {
    return second === undefined || second === ''
      ? undefined
      : `${first}/${second}`;
  }
  return first;
}

/**
 * Every external package a source text imports.
 *
 * The scan is TypeScript's own `preProcessFile` rather than a regex over the
 * text: it is the pass the compiler uses to find a file's module references, so
 * it already agrees with tsc about what an import is — static and dynamic
 * imports, `export … from`, `import type`, `import x = require(…)` and, with
 * JavaScript detection on, plain `require` calls.
 */
export function importedPackages(text: string): string[] {
  const { importedFiles } = ts.preProcessFile(text, true, true);

  const names = new Set<string>();
  for (const { fileName } of importedFiles) {
    const name = specifierPackage(fileName);
    if (name !== undefined) names.add(name);
  }
  return [...names].sort();
}

/** Every package name a manifest declares, across every dependency field. */
export function declaredPackages(
  manifest: Readonly<Record<string, unknown>>,
): Set<string> {
  const declared = new Set<string>();
  for (const field of DEPENDENCY_FIELDS) {
    const entry = manifest[field];
    if (!isRecord(entry)) continue;
    for (const name of Object.keys(entry)) declared.add(name);
  }
  return declared;
}

/**
 * A package's suppressions as import → reason, plus what is wrong with the way
 * they are written. A malformed suppression is a finding rather than a silent
 * skip: the whole point of the reason is that somebody wrote one.
 */
export function suppressions(manifest: Readonly<Record<string, unknown>>): {
  readonly reasons: Map<string, string>;
  readonly errors: readonly string[];
} {
  const declared = acmeBlock(manifest)?.[SUPPRESSION_KEY];
  const reasons = new Map<string, string>();
  const errors: string[] = [];

  if (declared === undefined) return { reasons, errors };
  if (!isRecord(declared)) {
    return {
      reasons,
      errors: [`acme.${SUPPRESSION_KEY} must be an object of import -> reason`],
    };
  }

  for (const [name, reason] of Object.entries(declared)) {
    if (typeof reason !== 'string' || reason.trim() === '') {
      errors.push(
        `acme.${SUPPRESSION_KEY}.${name} needs a written reason (a non-empty string)`,
      );
      continue;
    }
    reasons.set(name, reason);
  }

  return { reasons, errors };
}

/** Every package's imports, checked against its own manifest in one walk. */
export function checkImports(io: PackageIo): Violations {
  const violations = collectViolations();
  const packages = io.packages();
  const workspaceNames = new Set(
    packages.flatMap((pkg) => (pkg.declaredName ? [pkg.declaredName] : [])),
  );

  for (const pkg of packages) {
    const declared = declaredPackages(pkg.manifest);
    const { reasons, errors } = suppressions(pkg.manifest);
    for (const error of errors) violations.error(`${pkg.name}: ${error}`);

    const unsuppressed = new Set(reasons.keys());
    // One finding per undeclared package, naming the first file that imports
    // it: the fix is one manifest edit however many files made the import, and
    // a hundred lines saying so would bury the rest of the report.
    const undeclared = new Map<string, string>();

    for (const rel of io.files(pkg)) {
      if (!isSource(rel)) continue;

      for (const name of importedPackages(io.read(pkg, rel))) {
        // `turbo boundaries` owns the workspace edges.
        if (workspaceNames.has(name)) continue;
        if (declared.has(name)) continue;
        if (reasons.has(name)) {
          unsuppressed.delete(name);
          continue;
        }
        if (!undeclared.has(name)) undeclared.set(name, rel);
      }
    }

    for (const [name, rel] of undeclared) {
      violations.error(
        `${pkg.name}: imports \`${name}\` (${rel}) but declares it in no dependency field of ${pkg.rel}/package.json`,
      );
    }

    for (const name of unsuppressed) {
      violations.error(
        `${pkg.name}: acme.${SUPPRESSION_KEY}.${name} suppresses an import the package no longer makes — delete it`,
      );
    }
  }

  return violations;
}
