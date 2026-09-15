/**
 * The gate's scheduler: a stage table in, a result per stage out.
 *
 * The gate is read-only, so nothing it runs can invalidate anything else it
 * runs, and the only real constraint is the one `after` carries. That makes the
 * schedule small enough to be a function: start every stage whose predecessors
 * have settled, start the next ones as those settle, and hand back a result per
 * stage in the order the table declared them.
 *
 * How a stage is *run* is the caller's: the real runner spawns a process, and a
 * test passes a function that resolves a value. Every claim about ordering,
 * overlap and failure aggregation is therefore assertable without running a
 * stage.
 */
import type { Stage, StageOutcome, StageResult } from './stages';

/** How a stage is run. */
export type StageRunner = (stage: Stage) => Promise<StageOutcome>;

/**
 * Run every stage, respecting `after`, and return one result per stage in
 * declaration order.
 *
 * A stage is started as soon as everything it follows has settled, so
 * everything the table left unordered overlaps. `now` is injected so a test can
 * assert a reported duration.
 */
export async function runSchedule(
  stages: readonly Stage[],
  run: StageRunner,
  now: () => number = Date.now,
) {
  const results = new Map<string, StageResult>();
  const declared = new Map(stages.map((stage) => [stage.name, stage]));
  /** One promise per stage, so a stage two others follow is still run once. */
  const scheduled = new Map<string, Promise<void>>();

  /**
   * Schedule a stage and everything it follows. `chain` is the path taken to
   * reach it, which is what turns a cycle into a diagnostic instead of a hang.
   */
  const schedule = (stage: Stage, chain: readonly string[]): Promise<void> => {
    const already = scheduled.get(stage.name);
    if (already !== undefined) return already;
    if (chain.includes(stage.name)) {
      throw new Error(
        `stage "${stage.name}" follows itself (${[...chain, stage.name].join(' → ')})`,
      );
    }

    const predecessors = (stage.after ?? []).map((name) => {
      const found = declared.get(name);
      if (found === undefined) {
        throw new Error(
          `stage "${stage.name}" follows "${name}", which no stage declares`,
        );
      }
      return schedule(found, [...chain, stage.name]);
    });

    const settled = Promise.all(predecessors).then(async () => {
      const start = now();
      const outcome = await run(stage);
      results.set(stage.name, {
        stage,
        code: outcome.code,
        output: outcome.output,
        ms: now() - start,
      });
    });

    scheduled.set(stage.name, settled);
    return settled;
  };

  await Promise.all(stages.map((stage) => schedule(stage, [])));

  return stages.flatMap((stage) => results.get(stage.name) ?? []);
}
