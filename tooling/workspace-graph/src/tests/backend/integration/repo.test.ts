/**
 * The kernel against this repo, rather than a fixture — the answers every
 * script will consume have to be true of the workspace they actually run in.
 *
 * The subjects are DERIVED from the workspace, never named: the app under test
 * is whichever `apps/` holds, and every claim is one any checkout's closure can
 * satisfy. A suite naming this repo's apps and slices asserted the coupling the
 * graph exists to remove, and failed in a workspace that took a different
 * selection of packages.
 *
 * That rules one claim out of this file rather than rephrasing it. "A slim app
 * declares no `billing` because its graph carries no billing slice" is a fact
 * about *these* apps' dependencies, and nothing derived stands in for it: every
 * generic form of it restates the union this file is asking about, so it holds
 * by construction and asserts nothing. Union semantics are pinned over
 * controlled inputs in `unit/closure.test.ts` instead; the slim/full claim is
 * the app layer's to make.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { WorkspacePackage } from '../../../workspace';
import { repoRoot } from '../../../cli';
import { closureInfra, closurePackages, declaredInfra } from '../../../closure';
import {
  closureProvisioning,
  composeEnvironment,
  neededProfiles,
  neededSeeds,
} from '../../../provisioning';
import { resolveToken } from '../../../tokens';
import {
  parseWorkspaceGlobs,
  workspaceApps,
  workspaceDirs,
  workspacePackages,
} from '../../../workspace';

const root = repoRoot();
const apps = workspaceApps(root);
/**
 * The app the closure claims are asked of — the first this workspace holds, and
 * an empty list in one that holds none, which makes those claims vacuous rather
 * than a failure.
 */
const target = apps.slice(0, 1).map((app) => app.name);
const closure = closurePackages(root, target);
const infra = closureInfra(root, target);

const unscoped = (name: string) => name.replace(/^@[^/]+\//, '');
const scriptNames = (pkg: WorkspacePackage) =>
  typeof pkg.manifest.scripts === 'object' && pkg.manifest.scripts !== null
    ? Object.keys(pkg.manifest.scripts)
    : [];

describe('the workspace directories', () => {
  it('are exactly what pnpm-workspace.yaml declares', () => {
    const declared = parseWorkspaceGlobs(
      readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8'),
    ).map((glob) => glob.replace(/\/\*$/, ''));

    expect(workspaceDirs(root)).toEqual([...new Set(declared)]);
  });

  it('all exist on disk', () => {
    for (const dir of workspaceDirs(root)) {
      expect(existsSync(join(root, dir)), dir).toBe(true);
    }
  });
});

describe('the workspace packages', () => {
  it('are discovered in one walk, each with its manifest name', () => {
    const packages = workspacePackages(root);
    const names = packages.map((pkg) => pkg.name);

    // The package doing the reading is in the workspace it reads.
    expect(names).toContain('@acme/workspace-graph');
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    expect(packages.every((pkg) => pkg.declaredName === pkg.name)).toBe(true);
  });

  it('include every app a token can name', () => {
    const names = workspacePackages(root).map((pkg) => pkg.name);

    for (const app of apps) {
      expect(names).toContain(app.name);
      // The token a human types for it — the unscoped tail — names it back.
      expect(resolveToken(unscoped(app.name), apps, 'app').rel).toBe(app.rel);
    }
  });
});

describe('a closure', () => {
  it('is the full transitive workspace closure, tooling included', () => {
    expect(closure.map((pkg) => pkg.name)).toEqual(
      expect.arrayContaining(target),
    );
    expect(closure.some((pkg) => pkg.rel.startsWith('tooling/'))).toBe(true);
  });

  it('declares the infra its own members declare, sorted', () => {
    expect(infra).toEqual([...infra].sort());

    for (const profile of infra) {
      const owners = closure.filter((pkg) =>
        declaredInfra([pkg]).includes(profile),
      );
      expect(
        owners.map((pkg) => pkg.name),
        profile,
      ).not.toEqual([]);
    }
  });

  it('is empty when nothing is named', () => {
    expect(closurePackages(root, [])).toEqual([]);
    expect(closureInfra(root, [])).toEqual([]);
  });
});

describe('what the closure declares about provisioning it', () => {
  it('discovers a profile for what the closure declares, and nothing else', async () => {
    const discovered = await closureProvisioning(root, target);

    expect(discovered.map((profile) => profile.name)).toEqual(infra);

    // What gets started is a subset of that, in the same order — a prune drops
    // candidates, it never adds one or reorders them.
    const needed = neededProfiles(discovered);
    expect(infra.filter((profile) => needed.includes(profile))).toEqual(needed);
  });

  it('supplies every compose value as a non-empty string', async () => {
    const environment = composeEnvironment(
      await closureProvisioning(root, target),
    );

    for (const [key, value] of Object.entries(environment)) {
      expect(value, key).toBeTypeOf('string');
      expect(value, key).not.toBe('');
    }
  });

  it('names a script that exists for every seed it declares', async () => {
    const discovered = await closureProvisioning(root, target);
    const packages = workspacePackages(root);

    for (const seed of neededSeeds(discovered)) {
      const owner = packages.find((pkg) => pkg.name === seed.package);
      expect(owner, seed.package).toBeDefined();
      expect(owner ? scriptNames(owner) : [], seed.package).toContain(
        seed.script,
      );
    }
  });
});
