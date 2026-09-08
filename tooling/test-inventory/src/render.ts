/**
 * The report: what was collected, narrowed and turned into markdown.
 *
 * Pure, and taking the collected entries as a value rather than a suite to run,
 * so the shape of the output is assertable without spawning a vitest. The one
 * thing it will not do is invent structure — every heading and every count is
 * computed after the narrowing, so a count counts what survived the filter and
 * a package that keeps nothing loses its heading.
 */
import { dirname, join, relative, sep } from 'node:path';

import { TESTS_DIR } from './layout';

/** A test as `vitest list --json` reports it. */
export interface InventoryEntry {
  readonly name: string;
  /** Absolute path to the file the test was collected from. */
  readonly file: string;
}

/** One suite's collection — a `Suite` with what `vitest list` said about it. */
export interface CollectedSuite {
  readonly layer: string;
  readonly name: string;
  /** Absolute path to the package directory, which `file` is measured against. */
  readonly dir: string;
  readonly entries: readonly InventoryEntry[];
}

/** The narrowing the caller asked for; an unset axis means everything. */
export interface Filters {
  readonly layer?: ReadonlySet<string>;
  readonly kind?: ReadonlySet<string>;
}

export interface RenderOptions {
  /** The layer headings, in the order they are reported. */
  readonly layers: readonly string[];
  readonly filters?: Filters;
}

/**
 * The directories a test file sits under, relative to the package's
 * `src/tests/` — `["backend", "integration", "api"]`. That path *is* the
 * taxonomy (layer / kind / group), so it is both the group heading and the
 * filter axes, rather than something re-derived from a table this tool would
 * then have to keep in step.
 *
 * `null` for a test outside `src/tests/`: unconventional but real, and worth
 * seeing in the report even though it sits under no layer and no kind.
 *
 * @param file absolute path, as `vitest list` reports it
 */
function segmentsOf(file: string, pkgDir: string) {
  const rel = relative(join(pkgDir, TESTS_DIR), file).replaceAll(sep, '/');
  if (rel.startsWith('../')) return null;
  return rel.split('/').slice(0, -1);
}

/**
 * The group heading for a test file — its `segmentsOf` path, or, for one
 * outside `src/tests/`, its directory relative to the package.
 */
function groupOf(file: string, pkgDir: string) {
  const segments = segmentsOf(file, pkgDir);
  if (segments === null) {
    return relative(pkgDir, dirname(file)).replaceAll(sep, '/');
  }
  return segments.length === 0 ? '.' : segments.join('/');
}

/**
 * Whether a test file is one the caller asked for: its layer segment in
 * `--layer`, its kind segment in `--kind`, each unset meaning everything. A
 * file outside the canonical layout has neither segment, so any explicit filter
 * excludes it — it can't answer the question that was asked.
 */
export function matches(file: string, pkgDir: string, filters: Filters) {
  if (filters.layer === undefined && filters.kind === undefined) return true;
  const [layer, kind] = segmentsOf(file, pkgDir) ?? [];
  if (filters.layer !== undefined && (!layer || !filters.layer.has(layer))) {
    return false;
  }
  if (filters.kind !== undefined && (!kind || !filters.kind.has(kind))) {
    return false;
  }
  return true;
}

/** `12 tests` / `1 test` — every heading carries its count. */
function count(n: number) {
  return `${n} test${n === 1 ? '' : 's'}`;
}

export function render(
  collected: readonly CollectedSuite[],
  { layers, filters = {} }: RenderOptions,
) {
  const kept = collected.map((suite) => ({
    ...suite,
    entries: suite.entries.filter((entry) =>
      matches(entry.file, suite.dir, filters),
    ),
  }));

  const lines = ['# Test inventory', ''];
  let total = 0;

  for (const label of layers) {
    const packages = new Map<string, Map<string, string[]>>();
    for (const suite of kept) {
      if (suite.layer !== label || suite.entries.length === 0) continue;
      const groups = packages.get(suite.name) ?? new Map<string, string[]>();
      for (const entry of suite.entries) {
        const group = groupOf(entry.file, suite.dir);
        groups.set(group, [...(groups.get(group) ?? []), entry.name]);
      }
      packages.set(suite.name, groups);
    }
    if (packages.size === 0) continue;

    const layerTotal = [...packages.values()]
      .flatMap((groups) => [...groups.values()])
      .reduce((sum, names) => sum + names.length, 0);
    lines.push(`## ${label} (${count(layerTotal)})`, '');
    total += layerTotal;

    for (const [name, groups] of [...packages].sort((a, b) =>
      a[0].localeCompare(b[0]),
    )) {
      const pkgTotal = [...groups.values()].reduce(
        (sum, names) => sum + names.length,
        0,
      );
      lines.push(`### ${name} (${count(pkgTotal)})`, '');
      for (const [group, names] of [...groups].sort((a, b) =>
        a[0].localeCompare(b[0]),
      )) {
        lines.push(`#### ${group} (${count(names.length)})`, '');
        // Verbatim, describe chain and all: whatever `vitest list` reports is
        // what runs, including computed names.
        for (const name of names) lines.push(`- ${name}`);
        lines.push('');
      }
    }
  }

  const packageCount = new Set(
    kept.filter((suite) => suite.entries.length > 0).map((suite) => suite.name),
  ).size;
  lines.push(
    '---',
    '',
    `**Total: ${count(total)} in ${packageCount} packages.**`,
    '',
  );
  return lines.join('\n');
}
