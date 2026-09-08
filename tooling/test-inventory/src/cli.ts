#!/usr/bin/env tsx
/**
 * Test inventory — a markdown list of every test the suite collects.
 *
 * The test names in this repo read as behaviour, but they are only visible in a
 * passing run's scrollback, which makes auditing them impossible. This prints
 * them all, grouped and counted, without running a single one. Collection is
 * `vitest list` per package (see `./collect`), so no container starts and no
 * schema is pushed.
 *
 * A target narrows what is collected. A package name lists just that package.
 * An **app** name expands to the app's full transitive workspace closure,
 * tooling included, so the answer is what that deployable's suite actually
 * covers — platform packages are where low-value tests hide, and `@acme/redis`'s
 * durable-stream tests are load-bearing for chat, so nothing is trimmed. The
 * difference between a full app's inventory and a slim one's is then the
 * repo's subsetting claim, observable rather than asserted.
 *
 * Token resolution and the closure query come from `@acme/workspace-graph`, so
 * `nextjs` means the same app here as it does to `pnpm dev`.
 *
 * Output is markdown on stdout; progress and errors go to stderr, so the
 * markdown pipes cleanly. Nothing is written to the repo — this is an ad-hoc
 * read, not an artifact, so it stays out of the quality gate.
 *
 * `--layer` and `--kind` narrow the report to the path segments under
 * `src/tests/`; the canonical layout makes that prefix a filter axis rather than
 * a guess. They compose as an intersection, and every heading and count is
 * computed after the narrowing. `--out` writes the report to a file instead of
 * stdout. The group segment stays a heading and never becomes a third flag:
 * three ways to name a test is more than an audit needs.
 *
 * Usage:
 *   pnpm test:inventory                          # every package with tests
 *   pnpm test:inventory @acme/chat               # one package
 *   pnpm test:inventory nextjs-slim              # an app's whole closure
 *   pnpm test:inventory --layer backend --kind unit
 *   pnpm test:inventory --kind unit,integration --out inventory.md
 *
 * Exit codes:
 *   0  inventory printed
 *   1  a package's collection failed (its stderr is reported)
 *   2  bad usage — a bad flag, or a target naming nothing or two things
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { join } from 'node:path';

import { repoRoot } from '@acme/workspace-graph';

import { listSuite, mapLimit, vitestBin } from './collect';
import { parseArguments, USAGE } from './flags';
import { render } from './render';
import {
  expandTargets,
  findPackages,
  findSuites,
  inventoryLayers,
} from './suites';

/** A refusal, phrased for the human who typed the command. */
function refuse(reason: string) {
  process.stderr.write(`test-inventory: ${reason}\n\n${USAGE}\n`);
}

/**
 * The whole command, returning its exit code rather than calling `process.exit`
 * — the entry below owns that.
 */
async function run(argv: readonly string[]) {
  const parsed = parseArguments(argv);
  if (!parsed.ok) {
    refuse(parsed.message);
    return 2;
  }
  const { targets, filters, out } = parsed.args;

  const root = repoRoot();
  const layers = inventoryLayers(root);
  const packages = findPackages(root, layers);

  let names: Set<string> | undefined;
  try {
    names =
      targets.length > 0 ? expandTargets(root, targets, packages) : undefined;
  } catch (error) {
    refuse(error instanceof Error ? error.message : String(error));
    return 2;
  }

  const suites = findSuites(packages, names);
  if (suites.length === 0) {
    process.stderr.write(
      names === undefined
        ? 'test-inventory: no vitest configs found in the workspace\n'
        : `test-inventory: nothing to collect — no package named by ${targets.join(', ')} has a vitest config\n`,
    );
    return 1;
  }

  const bin = vitestBin(root);
  const scratch = mkdtempSync(join(tmpdir(), 'test-inventory-'));
  process.stderr.write(`Collecting ${suites.length} suites (no tests run)…\n`);
  try {
    const listed = await mapLimit(
      suites,
      Math.max(1, Math.min(8, availableParallelism() - 1)),
      async (suite) => {
        const { entries, failure } = await listSuite(suite, { bin, scratch });
        process.stderr.write(
          failure === undefined
            ? `  ✓ ${suite.name} ${suite.side} (${entries.length})\n`
            : `  ✗ ${suite.name} ${suite.side}\n`,
        );
        return { ...suite, entries, failure };
      },
    );

    const failed = listed.filter((suite) => suite.failure !== undefined);
    if (failed.length > 0) {
      process.stderr.write(
        `\n✗ Collection failed for ${failed.length} suite(s):\n\n`,
      );
      for (const suite of failed) {
        process.stderr.write(
          `  • ${suite.name} (${suite.config})\n${suite.failure ?? ''}\n\n`,
        );
      }
      return 1;
    }

    const report = render(listed, {
      layers: layers.map((layer) => layer.label),
      filters,
    });
    if (out === undefined) {
      process.stdout.write(report);
    } else {
      writeFileSync(out, report);
      process.stderr.write(`Wrote ${out}\n`);
    }
    return 0;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

run(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`${String(error)}\n`);
    process.exitCode = 1;
  },
);
