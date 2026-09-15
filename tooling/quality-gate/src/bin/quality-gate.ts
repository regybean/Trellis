#!/usr/bin/env tsx
/**
 * The full quality gate: every read-only check the repo has, run in parallel,
 * one summary and one log out.
 *
 * It verifies and never fixes, so `pnpm tidy` (lint:fix + format:fix) runs
 * first or the gate fails on a fixable formatting issue. Run it once at the end
 * of a task, not per commit — commits only tidy, and CI is the hard backstop.
 *
 * Usage:
 *   pnpm quality-gate            # from the repo root
 *
 * Exit codes:
 *   0  every stage passed
 *   1  at least one stage failed — the summary names it, `logs/quality-gate.log`
 *      carries its output
 */
import { resolveRoot } from '@acme/workspace-graph';

import { runQualityGate } from '../gate';

runQualityGate({ root: resolveRoot(process.argv.slice(2)) }).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`quality-gate: ${String(error)}\n`);
    process.exitCode = 1;
  },
);
