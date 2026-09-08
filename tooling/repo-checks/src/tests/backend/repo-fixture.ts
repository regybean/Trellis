/**
 * A throwaway repo on disk, for the tests that exercise a checker as a command.
 *
 * The rules have unit tests over values; what is left to prove of the CLI is
 * what only a process can show — its exit code, the shape of what it prints,
 * and that it checks the directory it was given. So these fixtures are real
 * files, and `tracked` gives them a real git index, since the ADR checker reads
 * `git ls-files` to stay out of untracked working directories.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Where this package's CLIs live, from a test's own location. */
const packageRoot = path.resolve(import.meta.dirname, '../../..');

export interface RepoFixture {
  /** The workspace globs. Defaults to the repo's own layer directories. */
  readonly globs?: readonly string[];
  /** Repo-relative paths mapped to contents. A key ending in `/` is an empty directory. */
  readonly files: Readonly<Record<string, string>>;
  /** Stage the files in a real git index, for a checker that reads `git ls-files`. */
  readonly tracked?: boolean;
}

const DEFAULT_GLOBS = [
  'apps/*',
  'packages/platform/*',
  'packages/shared/*',
  'packages/features/*',
  'tooling/*',
];

const fixtures: string[] = [];

/** Create the fixture and return its root. */
export function createRepoFixture({
  globs = DEFAULT_GLOBS,
  files,
  tracked = false,
}: RepoFixture): string {
  const root = mkdtempSync(path.join(tmpdir(), 'repo-checks-'));
  fixtures.push(root);

  writeFileSync(
    path.join(root, 'pnpm-workspace.yaml'),
    `packages:\n${globs.map((glob) => `  - ${glob}\n`).join('')}`,
  );

  for (const [rel, contents] of Object.entries(files)) {
    const absolute = path.join(root, rel);
    if (rel.endsWith('/')) {
      mkdirSync(absolute, { recursive: true });
      continue;
    }
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, contents);
  }

  if (tracked) {
    const git = (...args: string[]) =>
      execFileSync('git', args, {
        cwd: root,
        env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' },
      });
    git('init', '-q', '--initial-branch=main');
    git('add', '-A');
  }

  return root;
}

/** Remove every fixture this run created. */
export function removeRepoFixtures(): void {
  for (const root of fixtures.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
}

export interface Run {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
  /** Both streams, for an assertion that does not care which one carried it. */
  readonly output: string;
}

/** Run one of this package's CLIs against `args`. */
export function runCheck(bin: string, args: readonly string[]): Run {
  const result = spawnSync(
    'pnpm',
    ['exec', 'tsx', path.join('src', 'bin', `${bin}.ts`), ...args],
    { cwd: packageRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return {
    status: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
    output: result.stdout + result.stderr,
  };
}

/** A package manifest, as a fixture file. */
export const manifest = (contents: Record<string, unknown>) =>
  `${JSON.stringify(contents, null, 2)}\n`;
