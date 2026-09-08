/**
 * The filesystem edge every check reads through.
 *
 * The rules below are functions over values, but a checker still has to be
 * pointed at something. Naming that something as an interface is what lets the
 * whole checker — not just its individual rules — run against a fixture object
 * with nothing on disk, and it is what makes "walks the workspace once"
 * a property a test can assert rather than a claim in a comment.
 *
 * Both readers memoise: a checker asks for the package list once by
 * construction, and asking twice must not cost a second walk.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { WorkspacePackage } from '@acme/workspace-graph';
import { workspacePackages } from '@acme/workspace-graph';

/** What a per-package check reads. */
export interface PackageIo {
  /** Every workspace package. */
  packages(): readonly WorkspacePackage[];
  /**
   * Package-relative POSIX paths of everything in the package, directories
   * included with a trailing `/`. One walk per package serves every rule that
   * asks about a path; the rules that need file text ask for it by name.
   *
   * Directories are listed because the layout rule's sidedness half reads the
   * directory and not its contents — an empty `src/tests/frontend/` under a
   * backend-library is exactly the mis-filing it exists to catch.
   */
  files(pkg: WorkspacePackage): readonly string[];
  /** The text of a package-relative file. */
  read(pkg: WorkspacePackage, rel: string): string;
}

/** What a repo-wide check reads. */
export interface RepoIo {
  /**
   * Repo-relative POSIX paths of every tracked file, so untracked working
   * directories and `node_modules` never reach a rule.
   */
  tracked(): readonly string[];
  /** The text of a repo-relative file. */
  read(rel: string): string;
  /** Whether a repo-relative path exists. */
  exists(rel: string): boolean;
  /** Whether a repo-relative path is a symlink — content reached twice otherwise. */
  isSymlink(rel: string): boolean;
}

/** Build output and caches — never source, so never a package's own file. */
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.turbo',
  '.cache',
  '.next',
  'coverage',
]);

const toPosix = (value: string) => value.split(path.sep).join('/');

/** Everything under `dir`, as paths relative to it, directories trailing a `/`. */
function walk(dir: string, prefix = ''): string[] {
  let entries: { name: string; isDirectory: boolean }[];
  try {
    entries = readdirSync(dir, { withFileTypes: true }).map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
    }));
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory) {
      files.push(`${rel}/`, ...walk(path.join(dir, entry.name), rel));
    } else {
      files.push(rel);
    }
  }
  return files;
}

/** The real per-package reader, rooted at `root`. */
export function packageIo(root: string): PackageIo {
  let packages: readonly WorkspacePackage[] | undefined;
  const files = new Map<string, readonly string[]>();

  return {
    packages() {
      packages ??= workspacePackages(root);
      return packages;
    },
    files(pkg) {
      const cached = files.get(pkg.dir);
      if (cached) return cached;
      const walked = walk(pkg.dir);
      files.set(pkg.dir, walked);
      return walked;
    },
    read(pkg, rel) {
      return readFileSync(path.join(pkg.dir, rel), 'utf8');
    },
  };
}

/** The real repo-wide reader, rooted at `root`. */
export function repoIo(root: string): RepoIo {
  let tracked: readonly string[] | undefined;

  return {
    tracked() {
      tracked ??= execFileSync('git', ['ls-files', '-z'], {
        cwd: root,
        encoding: 'utf8',
      })
        .split('\0')
        .filter(Boolean)
        .map(toPosix);
      return tracked;
    },
    read(rel) {
      return readFileSync(path.join(root, rel), 'utf8');
    },
    exists(rel) {
      return existsSync(path.join(root, rel));
    },
    isSymlink(rel) {
      try {
        return lstatSync(path.join(root, rel)).isSymbolicLink();
      } catch {
        return false;
      }
    },
  };
}
