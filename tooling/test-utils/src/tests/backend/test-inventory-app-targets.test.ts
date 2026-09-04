/**
 * `pnpm test:inventory <app>` — the closure an app expands to, against this
 * repo rather than a sandbox.
 *
 * The package-target cases live in test-inventory.test.ts, in a throwaway
 * workspace, because naming a package needs no graph. An app target does: it
 * expands through `pnpm ls` over the installed workspace, which a sandbox has
 * no cheap way to fake without also faking the thing under test. So this file
 * runs the real CLI over the real graph.
 *
 * The subsetting assertion is why it earns its keep. `@acme/nextjs-slim` is the
 * repo's claim that a no-auth/no-billing subset really does drop those slices
 * from the graph (ADR 0010); comparing its inventory with `@acme/nextjs`'s makes
 * that claim observable instead of asserted. It has already paid for itself —
 * writing it surfaced an unused `@acme/auth` devDependency on chat and ingest
 * that was pulling auth into every slim closure.
 *
 * Cost: three collections of most of the repo. They run concurrently in
 * `beforeAll` and share one result each, so the file is roughly one and a half
 * full inventories of wall time — real, but bounded, and the only place the
 * subsetting claim is checked at all.
 *
 * Nothing here asserts a test count or a literal test name. Counts move every
 * week; which *packages* a deployable's suite covers is the contract.
 */

import { execFile } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';

const run = promisify(execFile);

const here = dirname(fileURLToPath(import.meta.url));
// src/tests/backend -> repo root is five levels up.
const repoRoot = resolve(here, '../../../../../');

/** The apps compared: same framework, one with auth and billing, one without. */
const FULL_APP = '@acme/nextjs';
const SLIM_APP = 'nextjs-slim';

/** Slices the slim subset is meant to leave out. */
const SUBSET_EXCLUDES = ['@acme/auth', '@acme/billing', '@acme/subscriptions'];

/**
 * The parent vitest advertises itself through `VITEST_*`; the nested ones the
 * CLI spawns must not inherit that and mistake themselves for workers of this
 * run.
 */
function childEnv() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('VITEST')),
  );
}

async function collect(...targets: string[]) {
  const { stdout } = await run(
    process.execPath,
    [
      '--import',
      'tsx',
      join(repoRoot, 'scripts/test-inventory.ts'),
      ...targets,
    ],
    {
      cwd: repoRoot,
      env: childEnv(),
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  return stdout;
}

/**
 * The inventory with each run of bullets sorted.
 *
 * `vitest list` makes no promise about the order it reports a suite's tests in,
 * and two runs of the same target do come back shuffled within a group. What is
 * being compared here is target resolution, not vitest's collection order, so
 * the ordering that is genuinely the tool's — headings, grouping, counts —
 * stays where it is and only the bullets are normalised.
 */
function stable(inventory: string) {
  const out: string[] = [];
  let bullets: string[] = [];
  for (const line of inventory.split('\n')) {
    if (line.startsWith('- ')) {
      bullets.push(line);
      continue;
    }
    out.push(...bullets.sort(), line);
    bullets = [];
  }
  return [...out, ...bullets.sort()].join('\n');
}

/** The `### ` package headings, without their counts, in printed order. */
function packages(inventory: string) {
  return inventory
    .split('\n')
    .filter((line) => line.startsWith('### '))
    .map((line) => line.slice(4).split(' (')[0]);
}

let full: string;
let slimShort: string;
let slimScoped: string;

beforeAll(async () => {
  [full, slimShort, slimScoped] = await Promise.all([
    collect(FULL_APP),
    collect(SLIM_APP),
    collect(`@acme/${SLIM_APP}`),
  ]);
}, 900_000);

describe('an app target expands to its whole workspace closure', () => {
  it('reaches past the app into the features it mounts', () => {
    expect(packages(slimShort)).toContain('@acme/chat');
  });

  it('includes tooling packages, which a deployable still tests through', () => {
    // @acme/test-utils is a devDependency of every package that has a suite —
    // exactly the kind of edge a production-only closure would drop.
    expect(packages(slimShort)).toContain('@acme/test-utils');
  });

  it('groups the closure under the layer headings, tooling first', () => {
    const layers = slimShort
      .split('\n')
      .filter((line) => line.startsWith('## '))
      .map((line) => line.slice(3).split(' (')[0]);
    expect(layers).toEqual(['tooling', 'platform', 'shared', 'features']);
  });
});

describe('a short app name means the same app as the scoped one', () => {
  it('gives the same inventory for nextjs-slim and @acme/nextjs-slim', () => {
    expect(stable(slimShort)).toBe(stable(slimScoped));
  });
});

describe('the slim subset is visible in what its inventory omits', () => {
  it.each(SUBSET_EXCLUDES)('leaves %s out of the slim closure', (pkg) => {
    expect(packages(slimShort)).not.toContain(pkg);
  });

  it.each(SUBSET_EXCLUDES)('keeps %s in the full app closure', (pkg) => {
    expect(packages(full)).toContain(pkg);
  });

  it('is otherwise the same suite — the slim set is a subset, not a fork', () => {
    const extra = packages(slimShort).filter(
      (pkg) => !packages(full).includes(pkg),
    );
    expect(extra).toEqual([]);
  });
});
