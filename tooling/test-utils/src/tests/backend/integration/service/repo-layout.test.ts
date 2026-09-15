/**
 * The two things the engine reads off disk: where the monorepo root is, and
 * which app can serve the schema push.
 *
 * Driven against throwaway directory trees in a temp dir — real `node:fs`, no
 * mock of it, and no container. Both functions used to be reachable only
 * through a module-level constant and a spawn, which is why neither branch of
 * either rule had ever been exercised.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { findPushApp, findRepoRoot } from '../../../../containers';

const trees: string[] = [];

/** A throwaway directory tree, holding the files given as repo-relative paths. */
function tree(...files: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'test-utils-layout-'));
  trees.push(root);
  for (const file of files) {
    const target = resolve(root, file);
    mkdirSync(resolve(target, '..'), { recursive: true });
    writeFileSync(target, '');
  }
  return root;
}

afterEach(() => {
  for (const root of trees.splice(0, trees.length)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('findRepoRoot', () => {
  it('walks up to the directory holding pnpm-workspace.yaml', () => {
    const root = tree('pnpm-workspace.yaml', 'tooling/test-utils/src/keep');

    expect(findRepoRoot(resolve(root, 'tooling/test-utils/src'))).toBe(root);
  });

  it('stops at the nearest marker when an outer one also exists', () => {
    const root = tree(
      'pnpm-workspace.yaml',
      'vendored/pnpm-workspace.yaml',
      'vendored/packages/keep',
    );

    expect(findRepoRoot(resolve(root, 'vendored/packages'))).toBe(
      resolve(root, 'vendored'),
    );
  });

  it('returns the directory it started from when no ancestor carries the marker', () => {
    const start = resolve(tree('packages/keep'), 'packages');

    expect(findRepoRoot(start)).toBe(start);
  });
});

describe('findPushApp', () => {
  it('finds the app carrying a drizzle push config', () => {
    const root = tree('apps/web/drizzle.push.config.ts');

    expect(findPushApp(root)).toBe(resolve(root, 'apps/web'));
  });

  it('takes the sorted-first app when several could serve the push', () => {
    const root = tree(
      'apps/zephyr/drizzle.push.config.ts',
      'apps/alpha/drizzle.push.config.ts',
    );

    expect(findPushApp(root)).toBe(resolve(root, 'apps/alpha'));
  });

  it('ignores an app with no push config', () => {
    const root = tree(
      'apps/site/package.json',
      'apps/web/drizzle.push.config.ts',
    );

    expect(findPushApp(root)).toBe(resolve(root, 'apps/web'));
  });

  it('refuses an app set where nothing can serve the push', () => {
    const root = tree('apps/site/package.json');

    expect(() => findPushApp(root)).toThrow(/drizzle\.push\.config\.ts/);
  });

  it('refuses a tree with no apps directory at all', () => {
    const root = tree('packages/keep');

    expect(() => findPushApp(root)).toThrow(/no app under apps/);
  });
});
