/**
 * The kernel against this repo, rather than a fixture — the answers every
 * script will consume have to be true of the workspace they actually run in.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { repoRoot } from '../../../cli';
import { closureInfra, closurePackages } from '../../../closure';
import { resolveToken } from '../../../tokens';
import {
  parseWorkspaceGlobs,
  workspaceApps,
  workspaceDirs,
  workspacePackages,
} from '../../../workspace';

const root = repoRoot();

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

    expect(names).toContain('@acme/workspace-graph');
    expect(names).toContain('@acme/test-utils');
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    expect(packages.every((pkg) => pkg.declaredName === pkg.name)).toBe(true);
  });

  it('include every app a token can name', () => {
    const apps = workspaceApps(root).map((pkg) => pkg.name);

    expect(apps).toContain('@acme/nextjs');
    expect(resolveToken('nextjs-slim', workspaceApps(root), 'app').rel).toBe(
      'apps/nextjs-slim',
    );
  });
});

describe('a closure', () => {
  it('is the full transitive workspace closure, tooling included', () => {
    const closure = closurePackages(root, ['@acme/nextjs']).map(
      (pkg) => pkg.name,
    );

    expect(closure).toContain('@acme/nextjs');
    expect(closure).toContain('@acme/chat');
    expect(closure).toContain('@acme/db');
    expect(closure).toContain('@acme/tsconfig');
  });

  it('declares the union of its members infra, sorted', () => {
    const infra = closureInfra(root, ['@acme/nextjs']);

    expect(infra).toContain('postgres');
    expect(infra).toContain('billing');
    expect(infra).toEqual([...infra].sort());
  });

  it('declares less when the graph carries less', () => {
    // The slim apps drop the billing slice, so the service it declares leaves
    // with it — derived, not listed anywhere (ADR 0009, ADR 0010).
    expect(closureInfra(root, ['@acme/nextjs-slim'])).not.toContain('billing');
  });

  it('is empty when nothing is named', () => {
    expect(closurePackages(root, [])).toEqual([]);
    expect(closureInfra(root, [])).toEqual([]);
  });
});
