/**
 * What the gate says when it is done: the assembled log and the summary.
 *
 * Both are functions over the settled results and nothing else, so the exact
 * text is assertable without running a stage — which matters because this text
 * *is* the gate's interface. It prints nothing for minutes, then one summary a
 * human reads and one log an agent greps for the stage that failed.
 *
 * The stage durations overlap, since only `build` runs serial-before the rest,
 * so the column is for finding the long pole and the summary says so rather
 * than leaving a reader to add it up against the elapsed time.
 */
import type { StageResult } from './stages';

/** PASS or FAIL, as the summary prints it. */
export function verdict(result: StageResult) {
  return result.code === 0 ? 'PASS' : 'FAIL';
}

/** Every stage that failed, in table order. */
export function failedStages(results: readonly StageResult[]) {
  return results
    .filter((result) => result.code !== 0)
    .map((result) => result.stage.name);
}

/**
 * A duration at the scale it is: whole minutes and seconds once it passes a
 * minute, hundredths below that. Sub-second stages are the ones that lose
 * precision, and they are the ones nobody is reading.
 */
export function formatDuration(ms: number) {
  if (ms >= 60_000) {
    const seconds = Math.floor((ms % 60_000) / 1000);
    return `${Math.floor(ms / 60_000)}m${String(seconds).padStart(2, '0')}s`;
  }
  const hundredths = Math.floor((ms % 1000) / 10);
  return `${Math.floor(ms / 1000)}.${String(hundredths).padStart(2, '0')}s`;
}

/** The long pole: the stage that took longest, table order breaking a tie. */
export function slowestStage(results: readonly StageResult[]) {
  return results.reduce<StageResult | undefined>(
    (slowest, result) =>
      slowest === undefined || result.ms > slowest.ms ? result : slowest,
    undefined,
  );
}

/**
 * Turbo's own accounting, totalled across the stages that go through it: how
 * many of the tasks it was asked for were cached, and how many actually ran.
 * The standalone stages are not turbo-cached and always run, so they are not
 * in it.
 *
 * Every capture is defaulted: an output that does not carry the line must
 * leave the rest of the summary intact rather than take it down.
 */
export function turboCache(results: readonly StageResult[]) {
  let cached = 0;
  let total = 0;

  for (const result of results.filter(({ stage }) => stage.turbo === true)) {
    const lines = result.output
      .split('\n')
      .filter((line) => /cached,.*total/.test(line));
    const last = lines.at(-1);
    if (last === undefined) continue;
    cached += Number(/(\d+) cached/.exec(last)?.[1] ?? 0);
    total += Number(/(\d+) total/.exec(last)?.[1] ?? 0);
  }

  return total > 0 ? { cached, total } : undefined;
}

/**
 * The assembled log: a dated freshness header, then every stage's output in
 * table order behind its own banner.
 *
 * The header is the same one every mirrored log file in `logs/` carries, so
 * staleness reads the same way here as it does for the dev-server files.
 */
export function assembleLog(results: readonly StageResult[], startedAt: Date) {
  const header = `# quality-gate started ${startedAt.toISOString().replace(/\.\d+Z$/, 'Z')}\n`;

  return results.reduce(
    (log, result) =>
      `${log}\n━━━━━━━━ ${result.stage.name} ━━━━━━━━\n${result.output}`,
    header,
  );
}

interface SummaryContext {
  /** Wall-clock time the whole run took. */
  readonly elapsedMs: number;
  /** Where the assembled log was written, as the reader should type it. */
  readonly logPath: string;
}

/** The summary block, verdict line included, exactly as it is printed. */
export function formatSummary(
  results: readonly StageResult[],
  { elapsedMs, logPath }: SummaryContext,
) {
  const lines = [
    '',
    '──────── quality-gate summary ────────',
    ...results.map(
      (result) =>
        `  ${verdict(result).padEnd(4)} ${result.stage.name.padEnd(16)} ${formatDuration(result.ms).padStart(8)}`,
    ),
  ];

  const cache = turboCache(results);
  if (cache !== undefined) {
    lines.push(
      `  cache:   ${cache.cached}/${cache.total} turbo tasks cached (${cache.total - cache.cached} ran)`,
    );
  }

  const slowest = slowestStage(results);
  if (slowest !== undefined) {
    lines.push(
      `  slowest: ${slowest.stage.name} (${formatDuration(slowest.ms)}) — most stages run in parallel, so the column above`,
      "           does not sum to elapsed; only 'build' is serial-before the rest",
    );
  }

  const seconds = Math.floor(elapsedMs / 1000);
  lines.push(
    `  elapsed: ${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s`,
    `  full log: ${logPath}`,
    ...(failedStages(results).length > 0
      ? [
          `  ✗ quality-gate FAILED — grep the failing stage in ${logPath}`,
          "  (read-only gate: if it's a fixable lint/format issue, run 'pnpm tidy' then re-run)",
        ]
      : ['  ✓ quality-gate passed']),
  );

  return `${lines.join('\n')}\n`;
}
