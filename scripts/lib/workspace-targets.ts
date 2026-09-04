// Turning a CLI token into workspace packages.
//
// Two root scripts take package or app names on the command line —
// `resolve-infra.ts` (which compose profiles an app needs) and
// `test-inventory.ts` (whose tests to list) — and both need the same two
// answers: which workspace package does this token name, and what is in that
// package's transitive closure.
//
// The closure query is a single `pnpm ls` and would be harmless duplicated.
// The token match is not: "short name" has to mean the same thing in
// `pnpm dev nextjs` as in `pnpm test:inventory nextjs`, and two copies of that
// rule drift. So it lives here, once.
//
// This module is imported by TS scripts run through `pnpm exec tsx`; it shells
// out to pnpm and touches nothing else, so it stays usable from any of them.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/** A workspace package, as found on disk. */
export interface WorkspacePackage {
  name: string;
  dir: string;
}

/** A project `pnpm ls --only-projects` reported for a closure. */
export interface WorkspaceProject {
  name: string;
  path: string;
}

const readName = (dir: string): string | undefined => {
  try {
    const json: unknown = JSON.parse(
      readFileSync(path.join(dir, "package.json"), "utf8"),
    );
    const name =
      typeof json === "object" && json !== null && "name" in json
        ? json.name
        : undefined;
    return typeof name === "string" ? name : undefined;
  } catch {
    // A directory under a workspace glob with no readable manifest is not a
    // package — skip it rather than failing the whole resolution.
    return undefined;
  }
};

/**
 * Every workspace package directly under `dir` (relative to `root`), sorted by
 * name. Used for `apps` — the set an app token may name.
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
    return [];
  }
  return entries
    .map((entry) => ({
      dir: path.join(layerDir, entry),
      name: readName(path.join(layerDir, entry)),
    }))
    .filter((pkg): pkg is WorkspacePackage => pkg.name !== undefined)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Every workspace package under `apps/`. */
export function workspaceApps(root: string): WorkspacePackage[] {
  return workspacePackagesIn(root, "apps");
}

/**
 * The package a CLI token names, or `undefined` when none does.
 *
 * A token may be the full name (`@acme/nextjs`), the unscoped tail
 * (`nextjs`), or the directory (`nextjs-slim`). The tail is matched against
 * the scope actually present rather than a hardcoded `@acme/`, so a renamed
 * scope needs no change here.
 *
 * @throws when the token is a tail two packages share — silently picking one
 * is the failure mode worth ruling out.
 */
export function matchToken(
  token: string,
  packages: WorkspacePackage[],
): WorkspacePackage | undefined {
  const exact = packages.find((pkg) => pkg.name === token);
  if (exact) return exact;

  const candidates = packages.filter(
    (pkg) => pkg.name.endsWith(`/${token}`) || path.basename(pkg.dir) === token,
  );
  if (candidates.length > 1) {
    const names = candidates.map((pkg) => pkg.name).join(", ");
    throw new Error(`"${token}" is ambiguous — it could mean ${names}`);
  }
  return candidates[0];
}

/**
 * The app name a CLI token resolves to.
 *
 * @throws when the token names no app.
 */
export function resolveAppToken(
  token: string,
  apps: WorkspacePackage[],
): string {
  const app = matchToken(token, apps);
  if (!app) throw new Error(`unknown app "${token}"`);
  return app.name;
}

/**
 * The union of every named package's transitive workspace closure, dev
 * dependencies and tooling included — one `pnpm ls` for the whole set.
 *
 * Reading the working tree rather than a git ref is the point: this answers
 * what a checkout's graph says right now, which is what both callers need.
 */
export function workspaceClosure(
  root: string,
  names: string[],
): WorkspaceProject[] {
  if (names.length === 0) return [];
  const filters = names.flatMap((name) => ["--filter", `${name}...`]);
  const raw = execFileSync(
    "pnpm",
    [...filters, "ls", "--only-projects", "--depth", "-1", "--json"],
    { cwd: root, encoding: "utf8" },
  );
  return JSON.parse(raw) as WorkspaceProject[];
}
