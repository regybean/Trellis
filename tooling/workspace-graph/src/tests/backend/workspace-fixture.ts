/**
 * A throwaway workspace on disk: a `pnpm-workspace.yaml` and whatever packages
 * a test wants under it.
 *
 * The rules here read real directories, so a fixture repo is the honest input —
 * and being able to point them at one is exactly what the checkers lacked.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export interface WorkspaceFixture {
  /** The workspace globs. Defaults to `apps/*` + `packages/shared/*`. */
  readonly globs?: readonly string[];
  /**
   * Package directories, relative to the fixture root, mapped to the manifest
   * to write there. `null` writes the directory with no manifest at all — a
   * directory under a glob that is not a package. A string is written verbatim,
   * for the manifest that is not valid JSON.
   */
  readonly packages: Readonly<
    Record<string, Record<string, unknown> | string | null>
  >;
  /** Raw `pnpm-workspace.yaml` contents, when a test needs a malformed one. */
  readonly workspaceFile?: string;
}

const roots: string[] = [];

/** Create the fixture and return its root. */
export function createWorkspaceFixture({
  globs = ['apps/*', 'packages/shared/*'],
  packages,
  workspaceFile,
}: WorkspaceFixture): string {
  const root = mkdtempSync(path.join(tmpdir(), 'workspace-graph-'));
  roots.push(root);

  writeFileSync(
    path.join(root, 'pnpm-workspace.yaml'),
    workspaceFile ?? `packages:\n${globs.map((g) => `  - ${g}\n`).join('')}`,
  );

  for (const [dir, manifest] of Object.entries(packages)) {
    const absolute = path.join(root, dir);
    mkdirSync(absolute, { recursive: true });
    if (manifest !== null) {
      writeFileSync(
        path.join(absolute, 'package.json'),
        typeof manifest === 'string'
          ? manifest
          : `${JSON.stringify(manifest, null, 2)}\n`,
      );
    }
  }

  return root;
}

/** Remove every fixture this run created. */
export function removeWorkspaceFixtures(): void {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
}
