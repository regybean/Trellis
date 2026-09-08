/**
 * What there is to collect: the layer directories, the packages in them, and
 * the (package, vitest config) pairs a run covers.
 *
 * The workspace itself is read through `@acme/workspace-graph` — the directory
 * list, the package walk and the token match are the same answers `pnpm dev`
 * gets, so `nextjs` means one app across every command that takes a target.
 */
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';

import type { WorkspacePackage } from '@acme/workspace-graph';
import {
  matchToken,
  workspaceApps,
  workspaceClosure,
  workspaceDirs,
  workspacePackagesIn,
} from '@acme/workspace-graph';

import type { TestLayer } from './layout';
import { configOf, TEST_LAYERS } from './layout';

/**
 * The layer directories in dependency order (tooling → platform → shared →
 * features → apps), so a package is read after everything it is built on.
 *
 * The set of directories comes from `pnpm-workspace.yaml`; only their order is
 * authored here, because the workspace file records which directories hold
 * packages and nothing about which way the graph points. A directory the
 * workspace grows that this list does not name is reported last rather than
 * dropped.
 */
const LAYER_ORDER = [
  'tooling',
  'packages/platform',
  'packages/shared',
  'packages/features',
  'apps',
];

/** A layer directory and the heading it is reported under. */
export interface InventoryLayer {
  /** The heading — `packages/platform` reads as `platform`. */
  readonly label: string;
  /** Repo-relative directory, as the workspace file gives it. */
  readonly dir: string;
}

/** A workspace package, with the layer it sits in and the suites it declares. */
export interface InventoryPackage extends WorkspacePackage {
  readonly layer: string;
  readonly sides: readonly TestLayer[];
}

/** One package's tests on one side — the unit a `vitest list` run covers. */
export interface Suite {
  readonly layer: string;
  readonly name: string;
  readonly dir: string;
  readonly side: TestLayer;
  readonly config: string;
}

export function inventoryLayers(root: string): InventoryLayer[] {
  const rank = (dir: string) => {
    const index = LAYER_ORDER.indexOf(dir);
    return index === -1 ? LAYER_ORDER.length : index;
  };
  return workspaceDirs(root)
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((dir) => ({ label: basename(dir), dir }));
}

/**
 * Every workspace package under the layer directories, with the sides it has a
 * vitest config for. A package with no config has no tests to collect and never
 * reaches the report — but it is still a legitimate target, and still part of a
 * closure.
 */
export function findPackages(
  root: string,
  layers: readonly InventoryLayer[],
): InventoryPackage[] {
  return layers.flatMap(({ label, dir }) =>
    workspacePackagesIn(root, dir).map((pkg) => ({
      ...pkg,
      layer: label,
      sides: TEST_LAYERS.filter((side) =>
        existsSync(join(pkg.dir, configOf(side))),
      ),
    })),
  );
}

/**
 * The suites to collect, narrowed to `names` when the caller gave targets.
 *
 * @param names `undefined` for every package; otherwise the exact set.
 */
export function findSuites(
  packages: readonly InventoryPackage[],
  names?: ReadonlySet<string>,
): Suite[] {
  const suites = packages
    .filter((pkg) => names === undefined || names.has(pkg.name))
    .flatMap(({ layer, name, dir, sides }) =>
      sides.map((side) => ({ layer, name, dir, side, config: configOf(side) })),
    );
  // The heading is the package name, so the report is ordered by that rather
  // than by the directory the walk found it in ("@acme/db" before
  // "@acme/entitlements").
  return suites.sort(
    (a, b) => a.name.localeCompare(b.name) || a.side.localeCompare(b.side),
  );
}

/**
 * The packages a target token stands for: an app expands to its transitive
 * closure, anything else is just itself.
 *
 * Apps are checked first and by the shared matcher, so `nextjs` names the same
 * app `pnpm dev nextjs` starts. A token naming nothing, or naming two things,
 * is a usage error rather than an empty report — silently printing nothing for
 * a typo is the failure worth ruling out.
 *
 * @throws when a token names no workspace package or app.
 */
export function expandTargets(
  root: string,
  tokens: readonly string[],
  packages: readonly InventoryPackage[],
): Set<string> {
  const apps = workspaceApps(root);
  const names = new Set<string>();
  const appTargets: string[] = [];

  for (const token of tokens) {
    const app = matchToken(token, apps);
    if (app) {
      appTargets.push(app.name);
      continue;
    }
    const pkg = matchToken(token, packages);
    if (!pkg) {
      throw new Error(`no workspace package or app is named "${token}"`);
    }
    names.add(pkg.name);
  }

  for (const project of workspaceClosure(root, appTargets)) {
    names.add(project.name);
  }
  return names;
}
