/**
 * `pnpm test:inventory <app>` — the closure an app expands to, against this
 * repo rather than a sandbox.
 *
 * The package-target cases live in inventory.test.ts, in a throwaway workspace,
 * because naming a package needs no graph. An app target does: it expands
 * through `pnpm ls` over the installed workspace, which a sandbox has no cheap
 * way to fake without also faking the thing under test. So this file runs the
 * real CLI over the real graph.
 *
 * The subsetting assertion is why it earns its keep. The slim app is the repo's
 * claim that a no-auth/no-billing subset really does drop those slices from the
 * graph; comparing its inventory with the full app's makes that claim
 * observable instead of asserted. It has already paid for itself — writing it
 * surfaced an unused `@acme/auth` devDependency on chat and ingest that was
 * pulling auth into every slim closure.
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
import { join } from 'node:path';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  closurePackages,
  repoRoot,
  workspaceApps,
} from '@acme/workspace-graph';

const run = promisify(execFile);

const root = repoRoot();
const CLI = join(root, 'tooling/test-inventory/src/cli.ts');

/** Slices the slim subset is meant to leave out. */
const SUBSET_EXCLUDES = ['@acme/auth', '@acme/billing', '@acme/subscriptions'];

/**
 * The pair compared, derived from the graph rather than named.
 *
 * The claim needs two apps whose closures differ by *exactly* the subset: one
 * carrying all three slices, one carrying none, and otherwise as alike as the
 * workspace allows. Every part of that is a graph question, so it is asked of
 * the graph — apps are consumer identity, and a test that named this repo's
 * would be asserting the claim only for the apps that happen to be here.
 *
 * The pair with the smallest symmetric difference wins, so the comparison is
 * the honest one when a workspace holds several of each. Names break a tie, so
 * the choice is stable across runs.
 */
function appPair() {
  const apps = workspaceApps(root)
    .map((app) => ({
      name: app.name,
      short: app.rel.slice('apps/'.length),
      carries: new Set(
        closurePackages(root, [app.name]).map((pkg) => pkg.name),
      ),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const candidates = apps
    .filter((app) => SUBSET_EXCLUDES.every((pkg) => app.carries.has(pkg)))
    .flatMap((full) =>
      apps
        .filter((app) => SUBSET_EXCLUDES.every((pkg) => !app.carries.has(pkg)))
        .map((slim) => ({
          full,
          slim,
          apart: [...full.carries, ...slim.carries].filter(
            (pkg) => full.carries.has(pkg) !== slim.carries.has(pkg),
          ).length,
        })),
    )
    .sort((a, b) => a.apart - b.apart);

  return candidates[0];
}

const pair = appPair();
const hasAppPair = pair !== undefined;
const NEEDS_APP_PAIR = `skipped: needs one app whose closure carries ${SUBSET_EXCLUDES.join(', ')} and one that carries none of them — this workspace has no such pair`;

/** A describe that names the content it wanted when it skips. */
function describeApps(name: string, suite: () => void) {
  describe.skipIf(!hasAppPair)(
    hasAppPair ? name : `${name} — ${NEEDS_APP_PAIR}`,
    suite,
  );
}

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
    ['--import', 'tsx', CLI, ...targets],
    {
      cwd: root,
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
  // Three collections of most of the repo: not worth paying for a run whose
  // every case is skipped.
  if (!hasAppPair) return;

  [full, slimShort, slimScoped] = await Promise.all([
    collect(pair.full.name),
    collect(pair.slim.short),
    collect(pair.slim.name),
  ]);
}, 900_000);

describeApps('an app target expands to its whole workspace closure', () => {
  it('reaches past the app into the features it mounts', () => {
    expect(packages(slimShort)).toContain('@acme/chat');
  });

  // The devDependency edge into tooling had a case here: @acme/test-utils
  // appearing in a deployable's inventory, being exactly the kind of edge a
  // production-only closure would drop. It is unobservable through this CLI
  // now. The inventory lists packages that collect tests, and the two checker
  // suites that gave test-utils one moved to @acme/repo-checks, which no app
  // depends on; every other dev-only edge in an app's closure is a config
  // package declaring `testClass: "none"`, which never collects anything. The
  // edge is intact — only the proxy for it is gone, so restoring the case
  // needs a closure the CLI reports rather than one inferred from what
  // collected.

  it('groups the closure under the layer headings, in dependency order', () => {
    // No tooling package in an app's closure carries a suite, so that layer is
    // absent rather than first — see above.
    const layers = slimShort
      .split('\n')
      .filter((line) => line.startsWith('## '))
      .map((line) => line.slice(3).split(' (')[0]);
    expect(layers).toEqual(['platform', 'shared', 'features']);
  });
});

describeApps('a short app name means the same app as the scoped one', () => {
  it('gives the same inventory either way', () => {
    expect(stable(slimShort)).toBe(stable(slimScoped));
  });
});

describeApps('the slim subset is visible in what its inventory omits', () => {
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
