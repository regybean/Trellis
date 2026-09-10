/**
 * The package `exports` convention.
 *
 * Every workspace package that ships an `exports` map follows the same shape:
 *
 *   1. Subpath keys are drawn from a bounded vocabulary — a fixed set of roles
 *      plus a handful of explicitly-registered one-off seams. No freeform
 *      subpaths: a new role is a deliberate edit here, not an ad-hoc addition.
 *
 *   2. Every entry uses the JIT source/compiled-types hybrid:
 *        "types"   -> ./dist/<name>.d.ts   (typecheck against prebuilt tsc output)
 *        "default" -> ./src/<name>.ts      (apps transpile raw TS)
 *      Nobody points `default` at `dist` (that would ship stale build output) or
 *      `types` at `src` (that would typecheck against untyped source).
 *
 * The rule is a function of a name and a map, which is the whole reason this
 * checker has tests at all: it used to derive the directory it checked from its
 * own file's depth, so it could not be aimed at a fixture, and consequently it
 * was the one checker in the repo with no coverage.
 */
import type { Violations } from '@acme/workspace-graph';
import { collectViolations } from '@acme/workspace-graph';

import type { PackageIo } from './io';

/**
 * The bounded export vocabulary. Roles are the reusable concerns a package may
 * surface; seams are one-off entry points that earned a named home. Adding a key
 * here is the deliberate act of widening the vocabulary — that is the point.
 */
export const ALLOWED_KEYS: ReadonlySet<string> = new Set([
  // main entry
  '.',
  // roles
  './server',
  './schema',
  './env', // the slice's one env factory — config *and* secrets
  './testing', // backend/test helpers shipped for consumers' suites
  // registered one-off seams
  './handler', // @acme/trpc — framework-parametric fetch handler
  './register', // @acme/telemetry — side-effecting preload entry
  './server-next', // @acme/billing — Next-specific server adapter
  './ownership-trpc', // @acme/rag — cross-feature ownership middleware
]);

const TYPES_RE = /^\.\/dist\/[\w./-]+\.d\.ts$/;
const DEFAULT_RE = /^\.\/src\/[\w./-]+\.ts$/;

/** The contract, printed under a failure. */
export const EXPORTS_HELP =
  'Subpath keys come from the bounded vocabulary, and every entry maps `types` to ./dist and `default` to ./src.';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * What is wrong with one package's `exports` map, as a list of messages.
 *
 * `undefined` is not a violation: apps and config-only packages ship no map and
 * there is nothing to police.
 */
export function validateExports(name: string, exportsMap: unknown): string[] {
  if (exportsMap === undefined) return [];

  if (!isRecord(exportsMap)) {
    return [`${name}: "exports" must be an object map of subpath -> entry`];
  }

  const errors: string[] = [];

  for (const [key, entry] of Object.entries(exportsMap)) {
    if (!ALLOWED_KEYS.has(key)) {
      errors.push(
        `${name}: export key \`${key}\` is not in the allowed vocabulary (${[...ALLOWED_KEYS].join(', ')}). Register it in tooling/repo-checks/src/exports.ts if it is a deliberate new role/seam.`,
      );
      continue;
    }

    if (!isRecord(entry)) {
      errors.push(
        `${name}: export \`${key}\` must be a { types, default } object`,
      );
      continue;
    }

    const extraKeys = Object.keys(entry).filter(
      (candidate) => candidate !== 'types' && candidate !== 'default',
    );
    if (extraKeys.length > 0) {
      errors.push(
        `${name}: export \`${key}\` has unexpected keys: ${extraKeys.join(', ')} (only "types" and "default" are allowed)`,
      );
    }

    if (typeof entry.types !== 'string' || !TYPES_RE.test(entry.types)) {
      errors.push(
        `${name}: export \`${key}\`.types must match ./dist/<name>.d.ts (got \`${String(entry.types)}\`)`,
      );
    }
    if (typeof entry.default !== 'string' || !DEFAULT_RE.test(entry.default)) {
      errors.push(
        `${name}: export \`${key}\`.default must match ./src/<name>.ts (got \`${String(entry.default)}\`)`,
      );
    }
  }

  return errors;
}

/**
 * Whether this convention governs the package in `rel`.
 *
 * The runtime layers only. Apps ship no `exports`; `tooling/*` packages
 * deliberately use a different shape (freeform config subpaths, consumed as
 * config rather than JIT-transpiled runtime) and are out of scope.
 * Derived from the path rather than listed, so the layer directories cannot
 * drift from `pnpm-workspace.yaml` the way the old hardcoded list did.
 */
export const isGoverned = (rel: string) => rel.startsWith('packages/');

/** Every package's `exports` map, checked in one workspace walk. */
export function checkExports(io: PackageIo): Violations {
  const violations = collectViolations();

  for (const pkg of io.packages()) {
    if (!isGoverned(pkg.rel)) continue;
    for (const error of validateExports(pkg.name, pkg.manifest.exports)) {
      violations.error(error);
    }
  }

  return violations;
}
