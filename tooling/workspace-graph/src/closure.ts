/**
 * The dependency graph: what a package's closure contains, and what that
 * closure declares it needs to run.
 *
 * The closure is asked of pnpm rather than walked here, so it is the resolver's
 * answer and not a second implementation of one. It reads the working tree
 * rather than a git ref: this answers what a checkout's graph says right now,
 * which is what every caller needs. (The bank asks the same question of a
 * commit instead, which is why it has its own walk.)
 */
import { execFileSync } from 'node:child_process';

import type { WorkspacePackage } from './workspace';
import { readPackage } from './workspace';

/** A project `pnpm ls --only-projects` reported for a closure. */
export interface WorkspaceProject {
  readonly name: string;
  /** Absolute path to the project directory. */
  readonly path: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The union of every named package's transitive workspace closure, dev
 * dependencies and tooling included — one `pnpm ls` for the whole set.
 *
 * Names must be full package names: this is the resolver's own filter syntax,
 * not the CLI token vocabulary (resolve a token first, with `resolveToken`).
 */
export function workspaceClosure(
  root: string,
  names: readonly string[],
): WorkspaceProject[] {
  if (names.length === 0) return [];
  const filters = names.flatMap((name) => ['--filter', `${name}...`]);
  const raw = execFileSync(
    'pnpm',
    [...filters, 'ls', '--only-projects', '--depth', '-1', '--json'],
    { cwd: root, encoding: 'utf8' },
  );
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('pnpm ls --json did not return a list of projects');
  }
  return parsed.flatMap((entry) =>
    isRecord(entry) &&
    typeof entry.name === 'string' &&
    typeof entry.path === 'string'
      ? [{ name: entry.name, path: entry.path }]
      : [],
  );
}

/**
 * The infrastructure `packages` declare, as the sorted union of their
 * `acme.infra` entries.
 *
 * Infra travels with the package that owns it, down the dependency edges,
 * exactly like code — so the infra a deployable needs is this union over its
 * closure and nothing is assumed on
 * ([ADR 0001](../docs/adr/0001-graph-derived-dev-infra.md)). Non-string entries
 * are ignored: validating the field is a checker's job, and this query stays
 * usable while a manifest is wrong.
 */
export function declaredInfra(packages: readonly WorkspacePackage[]): string[] {
  const infra = new Set<string>();
  for (const pkg of packages) {
    const acme = pkg.manifest.acme;
    if (!isRecord(acme) || !Array.isArray(acme.infra)) continue;
    for (const entry of acme.infra) {
      if (typeof entry === 'string') infra.add(entry);
    }
  }
  return [...infra].sort();
}

/** Every package in the transitive closure of `names`, with its manifest. */
export function closurePackages(
  root: string,
  names: readonly string[],
): WorkspacePackage[] {
  return workspaceClosure(root, names)
    .map((project) => readPackage(root, project.path))
    .filter((pkg): pkg is WorkspacePackage => pkg !== undefined)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The infrastructure the closure of `names` declares — the graph query behind
 * `pnpm dev` and `pnpm infra:up`
 * ([ADR 0001](../docs/adr/0001-graph-derived-dev-infra.md)).
 *
 * This is the candidate set: `pruneInfra` drops the services only needed under
 * a given configuration, from provider values the caller passes in — because
 * only the caller can import the authored development profiles that decide it.
 */
export function closureInfra(root: string, names: readonly string[]): string[] {
  return declaredInfra(closurePackages(root, names));
}
