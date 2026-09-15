/**
 * The gate, end to end: run the table, write the log, print the summary, and
 * hand back the exit code.
 *
 * `stages` and `out` are parameters rather than imports so the whole command —
 * including the exit code, which is the part a consumer's CI reads — is
 * assertable against stages that are real processes and no part of the real
 * gate.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Stage } from './stages';
import { spawnStages } from './exec';
import { assembleLog, failedStages, formatSummary } from './report';
import { runSchedule } from './schedule';
import { QUALITY_GATE_STAGES } from './stages';

/**
 * The assembled log lands in the repo's `logs/` directory, the one an agent is
 * able to read — a gate log under `.cache` is unreadable by the agent that has
 * to act on it. Per-stage scratch stays in `.cache`: it is intermediate, and
 * `logs/` is a flat `*.log` directory by contract.
 */
const LOG = 'logs/quality-gate.log';
const STAGE_DIR = '.cache/quality-gate.d';

interface GateContext {
  readonly root: string;
  readonly stages?: readonly Stage[];
  /** Where the summary is printed. */
  readonly out?: { write: (chunk: string) => void };
}

/** Run the gate. Returns the exit code: 0 if every stage passed, else 1. */
export async function runQualityGate({
  root,
  stages = QUALITY_GATE_STAGES,
  out = process.stdout,
}: GateContext) {
  const startedAt = new Date();
  const stageDir = join(root, STAGE_DIR);
  mkdirSync(stageDir, { recursive: true });
  mkdirSync(join(root, 'logs'), { recursive: true });
  for (const file of readdirSync(stageDir)) {
    rmSync(join(stageDir, file), { force: true });
  }

  const results = await runSchedule(stages, spawnStages({ root, stageDir }));

  writeFileSync(join(root, LOG), assembleLog(results, startedAt));
  out.write(
    formatSummary(results, {
      elapsedMs: Date.now() - startedAt.getTime(),
      logPath: LOG,
    }),
  );

  return failedStages(results).length > 0 ? 1 : 0;
}
