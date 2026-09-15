/**
 * `@acme/quality-gate` — the program behind `pnpm quality-gate`.
 *
 * The entry point is `src/bin/quality-gate.ts`; this is the parts it is made
 * of. They are separated where the seams are worth testing: what the gate runs
 * (`./stages`), how that is scheduled (`./schedule`), what it says
 * (`./report`), and the whole command including its exit code (`./gate`). Only
 * `./exec` starts a process, so everything else is assertable as a function
 * over a value.
 *
 * Consumed from source (no build step): nothing builds `tooling/*` at install
 * time, and the gate is the first thing a fresh checkout runs.
 */
export type { Stage, StageOutcome, StageResult } from './stages';
export { QUALITY_GATE_STAGES, tolerated } from './stages';

export type { StageRunner } from './schedule';
export { runSchedule } from './schedule';

export {
  assembleLog,
  failedStages,
  formatDuration,
  formatSummary,
  slowestStage,
  turboCache,
  verdict,
} from './report';

export { spawnStages } from './exec';

export { runQualityGate } from './gate';
