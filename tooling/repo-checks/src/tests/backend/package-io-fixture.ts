/**
 * A `PackageIo` over plain values — a workspace with no disk behind it.
 *
 * Every rule here reads manifests, paths and text, so a record of those three
 * things is the honest input. Materialising a package tree in a temp directory
 * to assert a string comparison is what these tests used to do, and it is what
 * naming the reader as an interface removes.
 *
 * It also counts its walks, because "the workspace is walked once" is a
 * property of the checker rather than a comment about it.
 */
import type { WorkspacePackage } from '@acme/workspace-graph';

import type { PackageIo } from '../../io';

export interface FixturePackage {
  /** The package's `package.json`, as parsed. */
  readonly manifest?: Record<string, unknown>;
  /**
   * Package-relative POSIX paths mapped to their text. A rule that only reads
   * the path is happy with `''`.
   */
  readonly files?: Readonly<Record<string, string>>;
}

export interface FixtureIo extends PackageIo {
  /** How many times the package list has been derived. */
  readonly walks: number;
}

/** A reader over `packages`, keyed by repo-relative package directory. */
export function fixtureIo(
  packages: Readonly<Record<string, FixturePackage>>,
): FixtureIo {
  let walks = 0;

  const entries = Object.entries(packages).map(([rel, fixture]) => {
    const manifest = fixture.manifest ?? {};
    const declaredName =
      typeof manifest.name === 'string' && manifest.name !== ''
        ? manifest.name
        : undefined;
    const pkg: WorkspacePackage = {
      name: declaredName ?? rel,
      declaredName,
      dir: `/fixture/${rel}`,
      rel,
      manifestPath: `/fixture/${rel}/package.json`,
      manifest,
    };
    return { pkg, files: fixture.files ?? {} };
  });

  const byDir = new Map(entries.map(({ pkg, files }) => [pkg.dir, files]));

  return {
    get walks() {
      return walks;
    },
    packages() {
      walks += 1;
      return entries.map(({ pkg }) => pkg);
    },
    files(pkg) {
      return Object.keys(byDir.get(pkg.dir) ?? {});
    },
    read(pkg, rel) {
      const text = byDir.get(pkg.dir)?.[rel];
      if (text === undefined) {
        throw new Error(`${pkg.name} has no file ${rel} in this fixture`);
      }
      return text;
    },
  };
}
