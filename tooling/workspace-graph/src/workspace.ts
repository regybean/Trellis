/**
 * Reading the workspace: which directories hold packages, and what is in them.
 *
 * Every repo script needs the same two answers and each used to compute them
 * itself. The directory list in particular was four hardcoded copies with three
 * different contents, two of them naming `packages/compositions` — a directory
 * that is in neither `pnpm-workspace.yaml` nor on disk (ADR 0011 removed it).
 * Deriving the list from the workspace file removes that class of drift by
 * construction: the config is the only place the answer exists.
 *
 * The walk reads each manifest once and hands it back with the package, so a
 * caller that wants `scripts`, `exports` or `acme` does not re-read the file —
 * and no caller walks the tree more than once.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** The workspace file every derivation here starts from. */
export const WORKSPACE_FILE = 'pnpm-workspace.yaml';

/** A workspace package, as found on disk. */
export interface WorkspacePackage {
  /**
   * The manifest's `name`, or `rel` when it declares none. Every consumer
   * needed a name to put in a message and every one of them invented the same
   * fallback, so it is applied once, here.
   */
  readonly name: string;
  /** The manifest's `name`, or `undefined` when it declares none. */
  readonly declaredName: string | undefined;
  /** Absolute path to the package directory. */
  readonly dir: string;
  /** Repo-relative package directory, POSIX-separated (`packages/shared/ui`). */
  readonly rel: string;
  /** Absolute path to the package's `package.json`. */
  readonly manifestPath: string;
  /** The parsed manifest, unnarrowed — the rules that read it are its validators. */
  readonly manifest: Readonly<Record<string, unknown>>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const toPosix = (value: string) => value.split(path.sep).join('/');

/**
 * The workspace globs a `pnpm-workspace.yaml` declares.
 *
 * `packages:` is a flat sequence of glob strings, so a line scanner reads it
 * without a YAML dependency — the same reading `tooling/bank/src/lib/bank-closure.mjs`
 * performs, which cannot import this package because it runs before anything is
 * installed.
 *
 * @throws when the file declares no `packages:` key or no globs under it.
 */
export function parseWorkspaceGlobs(
  raw: string,
  what: string = WORKSPACE_FILE,
): string[] {
  const lines = raw.split('\n');
  const start = lines.findIndex((line) => /^packages:\s*$/.test(line));
  if (start === -1) throw new Error(`${what} has no "packages:" key`);

  const globs: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\s*(#.*)?$/.test(line)) continue; // blank line or comment
    const item = /^\s+-\s+(.+?)\s*$/.exec(line);
    if (!item?.[1]) break; // the next top-level key ends the sequence
    globs.push(item[1].replace(/^["']|["']$/g, ''));
  }

  if (globs.length === 0) throw new Error(`${what} lists no workspace globs`);
  return globs;
}

/**
 * The directory a workspace glob covers — `packages/shared/*` is
 * `packages/shared`. A glob with no wildcard is its own directory.
 */
const globDir = (glob: string) => glob.replace(/\/[^/]*\*.*$/, '');

/**
 * Every directory that directly holds workspace packages, in the order
 * `pnpm-workspace.yaml` lists them.
 *
 * This is the list that used to be hardcoded per script. It reports what the
 * workspace configuration says and nothing else: a directory the config names
 * but disk does not have still appears here, and is simply found empty by the
 * walk below.
 */
export function workspaceDirs(root: string): string[] {
  const raw = readFileSync(path.join(root, WORKSPACE_FILE), 'utf8');
  return [...new Set(parseWorkspaceGlobs(raw).map(globDir))];
}

/**
 * The package in `dir`, or `undefined` when `dir` holds no readable manifest —
 * a directory under a workspace glob without one is not a package, so it is
 * skipped rather than failing the whole read.
 *
 * A manifest that exists but is not parseable JSON throws: that is a broken
 * package, not an absent one, and the silent skip is what makes it hard to find.
 */
export function readPackage(
  root: string,
  dir: string,
): WorkspacePackage | undefined {
  const absolute = path.resolve(root, dir);
  const manifestPath = path.join(absolute, 'package.json');

  let raw: string;
  try {
    raw = readFileSync(manifestPath, 'utf8');
  } catch {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `${manifestPath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isRecord(parsed)) {
    throw new Error(`${manifestPath} is not a JSON object`);
  }

  const declaredName =
    typeof parsed.name === 'string' && parsed.name !== ''
      ? parsed.name
      : undefined;
  const rel = toPosix(path.relative(root, absolute));

  return {
    name: declaredName ?? rel,
    declaredName,
    dir: absolute,
    rel,
    manifestPath,
    manifest: parsed,
  };
}

/**
 * Every workspace package directly under `dir` (relative to `root`), sorted by
 * name.
 */
export function workspacePackagesIn(
  root: string,
  dir: string,
): WorkspacePackage[] {
  const layerDir = path.join(root, dir);
  let entries: string[];
  try {
    entries = readdirSync(layerDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return []; // a directory the workspace names but disk does not have
  }
  return entries
    .map((entry) => readPackage(root, path.join(layerDir, entry)))
    .filter((pkg): pkg is WorkspacePackage => pkg !== undefined)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Every workspace package in the repo, sorted by name — one walk, serving every
 * caller that used to run its own.
 */
export function workspacePackages(root: string): WorkspacePackage[] {
  return workspaceDirs(root)
    .flatMap((dir) => workspacePackagesIn(root, dir))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Every workspace package under `apps/` — the set an app token may name. */
export function workspaceApps(root: string): WorkspacePackage[] {
  return workspacePackagesIn(root, 'apps');
}
