/**
 * Running `vitest list` — the only part of the tool that starts a process.
 *
 * The data source is `vitest list --json`, once per package vitest config. That
 * matters: it honours each package's real `include` and resolves computed names
 * (`it.each`), so the output is what actually runs rather than what a filesystem
 * glob guesses. Nothing here parses a test file. Note the corollary: `vitest
 * list` reports only what would run, so a `.skip` or `.todo` appears nowhere in
 * the inventory.
 *
 * `vitest list` normally runs `globalSetup`, which for a backend suite means
 * starting testcontainers and pushing a schema purely to print names. So this
 * sets `VITEST_LIST_ONLY`, which `backendProject` reads to omit `globalSetup`
 * (tooling/test-utils/src/vitest.ts) — collection needs no infra, and every
 * reachable `env.ts` still validates against `staticTestEnv`. Listing is
 * therefore seconds, and needs no container runtime at all.
 */
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import type { InventoryEntry } from './render';
import type { Suite } from './suites';

/** Rejects on a non-zero exit, with both streams on the error. */
const run = promisify(execFile);

/**
 * The workspace's own vitest, run directly on this node rather than through
 * `pnpm exec`: twenty package-manager startups is real time, and resolving from
 * the root manifest is the same lookup pnpm would do.
 */
export function vitestBin(root: string) {
  const require = createRequire(join(root, 'package.json'));
  const manifestPath = require.resolve('vitest/package.json');
  const manifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const bin =
    typeof manifest === 'object' &&
    manifest !== null &&
    'bin' in manifest &&
    typeof manifest.bin === 'object' &&
    manifest.bin !== null &&
    'vitest' in manifest.bin &&
    typeof manifest.bin.vitest === 'string'
      ? manifest.bin.vitest
      : undefined;
  if (bin === undefined) {
    throw new Error(`${manifestPath} declares no vitest bin`);
  }
  return join(dirname(manifestPath), bin);
}

/**
 * `vitest list` for one suite, as the entries it reported.
 *
 * The JSON goes to a file rather than stdout: a config's own imports are free
 * to log, and mixing that into the stream we parse would make collection
 * fragile for no reason.
 */
export async function listSuite(
  suite: Suite,
  { bin, scratch }: { bin: string; scratch: string },
): Promise<{ entries: InventoryEntry[]; failure?: string }> {
  const out = join(
    scratch,
    `${suite.name.replaceAll('/', '_')}-${suite.config}.json`,
  );
  try {
    await run(
      process.execPath,
      [bin, 'list', '--config', suite.config, `--json=${out}`],
      {
        cwd: suite.dir,
        // The one carve-out that keeps listing cheap. See the header.
        env: { ...process.env, VITEST_LIST_ONLY: '1' },
      },
    );
  } catch (error) {
    // A vitest that cannot collect says why on its own streams; that is the
    // whole report, so hand it back rather than paraphrasing it.
    const { stdout = '', stderr = '' } = (error ?? {}) as {
      stdout?: string;
      stderr?: string;
    };
    return {
      entries: [],
      failure: `${stdout}${stderr}`.trim() || String(error),
    };
  }
  if (!existsSync(out)) {
    return { entries: [], failure: `vitest wrote no list to ${out}` };
  }
  const listed: unknown = JSON.parse(readFileSync(out, 'utf8'));
  if (!Array.isArray(listed)) {
    return { entries: [], failure: `vitest wrote no list of tests to ${out}` };
  }
  return {
    entries: listed.flatMap((entry: unknown) =>
      typeof entry === 'object' &&
      entry !== null &&
      'name' in entry &&
      typeof entry.name === 'string' &&
      'file' in entry &&
      typeof entry.file === 'string'
        ? [{ name: entry.name, file: entry.file }]
        : [],
    ),
  };
}

/**
 * Run `fn` over `items`, at most `limit` at a time. Collection is CPU-bound and
 * touches nothing shared, so the suites are independent and the only reason to
 * cap is not to swamp the machine.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await fn(item);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}
