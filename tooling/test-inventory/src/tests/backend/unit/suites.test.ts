/**
 * What there is to collect, before anything is collected.
 *
 * The layer directories come from the workspace file and their order does not —
 * `pnpm-workspace.yaml` records which directories hold packages and nothing
 * about which way the graph points, so the dependency order is the tool's and
 * is asserted here. Suite selection is a pure narrowing over the packages found,
 * so it is asserted the same way.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { InventoryPackage } from '../../../suites';
import { findSuites, inventoryLayers } from '../../../suites';

let workspace: string;

/** A workspace file listing `globs`, in the order given. */
function writeWorkspace(...globs: string[]) {
  writeFileSync(
    join(workspace, 'pnpm-workspace.yaml'),
    ['packages:', ...globs.map((glob) => `  - ${glob}`), ''].join('\n'),
  );
}

const pkg = (
  over: Pick<InventoryPackage, 'name' | 'layer' | 'sides'>,
): InventoryPackage => ({
  declaredName: over.name,
  dir: join('/repo', over.name),
  rel: over.name,
  manifestPath: join('/repo', over.name, 'package.json'),
  manifest: {},
  ...over,
});

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), 'test-inventory-suites-'));
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('the layer directories are read from the workspace', () => {
  it('reports them in dependency order, not the order the file lists', () => {
    writeWorkspace(
      'apps/*',
      'packages/platform/*',
      'packages/shared/*',
      'packages/features/*',
      'tooling/*',
    );
    expect(inventoryLayers(workspace).map((layer) => layer.label)).toEqual([
      'tooling',
      'platform',
      'shared',
      'features',
      'apps',
    ]);
  });

  it('reports only the directories the workspace declares', () => {
    writeWorkspace('packages/features/*', 'tooling/*');
    expect(inventoryLayers(workspace).map((layer) => layer.dir)).toEqual([
      'tooling',
      'packages/features',
    ]);
  });

  it('reports a directory it knows no place for last, rather than dropping it', () => {
    writeWorkspace('examples/*', 'tooling/*');
    expect(inventoryLayers(workspace).map((layer) => layer.label)).toEqual([
      'tooling',
      'examples',
    ]);
  });
});

describe('the suites are the sides each package declares', () => {
  const packages = [
    pkg({ name: '@acme/redis', layer: 'platform', sides: ['backend'] }),
    pkg({
      name: '@acme/chat',
      layer: 'features',
      sides: ['backend', 'frontend'],
    }),
    pkg({ name: '@acme/logger', layer: 'platform', sides: [] }),
  ];

  it('gives a two-sided package one suite per side', () => {
    expect(
      findSuites(packages).map((suite) => `${suite.name} ${suite.side}`),
    ).toEqual([
      '@acme/chat backend',
      '@acme/chat frontend',
      '@acme/redis backend',
    ]);
  });

  it('names each suite the config file its side is declared in', () => {
    expect(findSuites(packages).map((suite) => suite.config)).toEqual([
      'vitest.config.backend.ts',
      'vitest.config.frontend.ts',
      'vitest.config.backend.ts',
    ]);
  });

  it('leaves out a package that declares no suite', () => {
    expect(findSuites(packages).map((suite) => suite.name)).not.toContain(
      '@acme/logger',
    );
  });

  it('narrows to the names given, when the caller gave targets', () => {
    expect(
      findSuites(packages, new Set(['@acme/redis'])).map((suite) => suite.name),
    ).toEqual(['@acme/redis']);
  });

  it('collects nothing for a name that declares no suite', () => {
    expect(findSuites(packages, new Set(['@acme/logger']))).toEqual([]);
  });
});
