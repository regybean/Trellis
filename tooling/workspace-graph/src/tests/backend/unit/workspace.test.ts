import { afterAll, describe, expect, it } from 'vitest';

import {
  parseWorkspaceGlobs,
  readPackage,
  workspaceApps,
  workspaceDirs,
  workspacePackages,
} from '../../../workspace';
import {
  createWorkspaceFixture,
  removeWorkspaceFixtures,
} from '../workspace-fixture';

afterAll(() => {
  removeWorkspaceFixtures();
});

describe('parseWorkspaceGlobs', () => {
  it('reads the packages sequence, skipping blanks and comments', () => {
    const globs = parseWorkspaceGlobs(
      ['packages:', '  # the apps', '  - apps/*', '', '  - tooling/*', ''].join(
        '\n',
      ),
    );

    expect(globs).toEqual(['apps/*', 'tooling/*']);
  });

  it('stops at the next top-level key', () => {
    const globs = parseWorkspaceGlobs(
      ['packages:', '  - apps/*', 'catalog:', '  zod: ^4.1.12'].join('\n'),
    );

    expect(globs).toEqual(['apps/*']);
  });

  it('strips quotes from a quoted glob', () => {
    expect(parseWorkspaceGlobs('packages:\n  - "apps/*"')).toEqual(['apps/*']);
  });

  it('refuses a file with no packages key', () => {
    expect(() => parseWorkspaceGlobs('catalog:\n  zod: ^4.1.12')).toThrow(
      /no "packages:" key/,
    );
  });

  it('refuses a packages key listing nothing', () => {
    expect(() => parseWorkspaceGlobs('packages:\ncatalog:')).toThrow(
      /lists no workspace globs/,
    );
  });
});

describe('workspaceDirs', () => {
  it('derives the directories from the workspace configuration', () => {
    const root = createWorkspaceFixture({
      globs: ['apps/*', 'packages/shared/*', 'tooling/*'],
      packages: {},
    });

    expect(workspaceDirs(root)).toEqual(['apps', 'packages/shared', 'tooling']);
  });

  it('reports a directory named by no glob nowhere', () => {
    const root = createWorkspaceFixture({
      globs: ['apps/*'],
      packages: { 'packages/compositions/shell': { name: '@fixture/shell' } },
    });

    expect(workspaceDirs(root)).not.toContain('packages/compositions');
  });
});

describe('workspacePackages', () => {
  const root = createWorkspaceFixture({
    globs: ['apps/*', 'packages/shared/*'],
    packages: {
      'apps/web': { name: '@fixture/web' },
      'packages/shared/ui': { name: '@fixture/ui' },
      'packages/shared/scratch': null,
      'packages/shared/unnamed': { version: '0.0.1' },
    },
  });

  it('returns every package with its directory and its manifest name', () => {
    expect(
      workspacePackages(root).map((pkg) => ({ name: pkg.name, rel: pkg.rel })),
    ).toEqual([
      { name: '@fixture/ui', rel: 'packages/shared/ui' },
      { name: '@fixture/web', rel: 'apps/web' },
      { name: 'packages/shared/unnamed', rel: 'packages/shared/unnamed' },
    ]);
  });

  it('hands back the parsed manifest, so no caller re-reads it', () => {
    const ui = workspacePackages(root).find(
      (pkg) => pkg.name === '@fixture/ui',
    );

    expect(ui?.manifest).toEqual({ name: '@fixture/ui' });
    expect(ui?.manifestPath).toBe(`${root}/packages/shared/ui/package.json`);
  });

  it('names a package with no declared name after its directory', () => {
    const unnamed = workspacePackages(root).find(
      (pkg) => pkg.rel === 'packages/shared/unnamed',
    );

    expect(unnamed?.name).toBe('packages/shared/unnamed');
    expect(unnamed?.declaredName).toBeUndefined();
  });

  it('walks only the directories the workspace declares', () => {
    expect(workspaceApps(root).map((pkg) => pkg.name)).toEqual([
      '@fixture/web',
    ]);
  });
});

describe('readPackage', () => {
  it('reports no package for a directory with no manifest', () => {
    const root = createWorkspaceFixture({
      packages: { 'packages/shared/scratch': null },
    });

    expect(readPackage(root, 'packages/shared/scratch')).toBeUndefined();
  });

  it('refuses a manifest that is not valid JSON', () => {
    const root = createWorkspaceFixture({
      packages: { 'packages/shared/broken': '{ "name": ' },
    });

    expect(() => readPackage(root, 'packages/shared/broken')).toThrow(
      /is not valid JSON/,
    );
  });
});
