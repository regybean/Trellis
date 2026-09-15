/**
 * What the gate runs, as data.
 *
 * The gate is read-only verification: nothing it runs can invalidate anything
 * else it runs, so the table below is almost entirely unordered and the only
 * thing it has to say is which stages follow `build`. Everything the shell
 * version expressed as background jobs, return-code files and a `wait` is
 * expressed here as rows, which is what lets the scheduler be a function and
 * the schedule be asserted without running a stage.
 *
 * Two properties are worth reading off the table rather than out of prose:
 *
 *   - **Only `build` is followed.** `turbo` and `test` both need `^build`, and
 *     two concurrent `turbo run` invocations do not share task execution, so
 *     without priming the prerequisite once they each build the graph. Every
 *     other stage depends on nothing and overlaps everything.
 *   - **`test` is its own stage and not part of the `turbo` batch.** It needs
 *     the concurrency cap in the root test script, because every backend suite
 *     starts its own containers — and that cap must not throttle lint, format
 *     and typecheck, which is exactly what folding it into the batch would do.
 *
 * The argv is what the shell ran, verbatim, because the gate's contract
 * includes its exit code and a rewritten command is a different program.
 */

/** One unit of verification: a name, a command, and what it has to follow. */
export interface Stage {
  readonly name: string;
  /** argv, run from the repo root. */
  readonly command: readonly string[];
  /**
   * Stage names this one starts after. Ordering only, never a condition: a
   * predecessor that fails still releases its successors, because the gate
   * reports every stage rather than stopping at the first failure.
   */
  readonly after?: readonly string[];
  /**
   * This stage runs through turbo, so its output carries turbo's
   * "N cached, M total" line and the summary can total the cache across them.
   */
  readonly turbo?: boolean;
  /** A failure this stage is allowed to downgrade — see `tolerated`. */
  readonly tolerate?: {
    readonly pattern: RegExp;
    readonly note: string;
  };
}

/** What running a stage produced. */
export interface StageOutcome {
  readonly code: number;
  readonly output: string;
}

/** A settled stage: what ran, how it ended, and how long it took. */
export interface StageResult {
  readonly stage: Stage;
  readonly code: number;
  readonly output: string;
  readonly ms: number;
}

/**
 * The outcome a stage's own tolerance allows, with the note appended so the
 * assembled log says why the stage reads green.
 *
 * A stage that declares no tolerance is returned untouched, which is all but
 * one of them.
 */
export function tolerated(stage: Stage, outcome: StageOutcome) {
  const tolerance = stage.tolerate;
  if (
    tolerance === undefined ||
    outcome.code === 0 ||
    !tolerance.pattern.test(outcome.output)
  ) {
    return outcome;
  }
  return { code: 0, output: `${outcome.output}${tolerance.note}\n` };
}

/**
 * The dependency audit tolerates one failure and one only: not reaching the
 * registry at all, so offline work is not blocked while CI stays the hard
 * backstop. A registry that answers with advisories still fails the stage.
 */
const REGISTRY_UNREACHABLE =
  /ENOTFOUND| EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|ECONNRESET|socket hang up|getaddrinfo|request to .* failed|ERR_PNPM_META_FETCH_FAIL|ERR_PNPM_AUDIT|network/i;

/** The gate. Its order is the order the summary and the assembled log use. */
export const QUALITY_GATE_STAGES: readonly Stage[] = [
  { name: 'build', command: ['pnpm', 'turbo', 'run', 'build'], turbo: true },
  {
    name: 'turbo',
    command: [
      'pnpm',
      'turbo',
      'run',
      'lint',
      'format',
      'typecheck',
      '--continue',
    ],
    after: ['build'],
    turbo: true,
  },
  { name: 'test', command: ['pnpm', 'test'], after: ['build'], turbo: true },
  { name: 'check:exports', command: ['pnpm', 'check:exports'] },
  { name: 'check:imports', command: ['pnpm', 'check:imports'] },
  { name: 'check:bank-paths', command: ['pnpm', 'check:bank-paths'] },
  { name: 'check:bank-tokens', command: ['pnpm', 'check:bank-tokens'] },
  { name: 'check:adrs', command: ['pnpm', 'check:adrs'] },
  { name: 'check:portable', command: ['pnpm', 'check:portable'] },
  { name: 'boundaries', command: ['pnpm', 'boundaries'] },
  { name: 'lint:ws', command: ['pnpm', 'lint:ws'] },
  { name: 'deps:lint', command: ['pnpm', 'deps:lint'] },
  { name: 'test:policy', command: ['pnpm', 'test:policy'] },
  { name: 'gitleaks', command: ['pnpm', 'gitleaks'] },
  {
    // `pnpm run audit`, not `pnpm audit`: the latter's exit code counts
    // allowlisted advisories, so one suppression would pin this stage red.
    name: 'audit',
    command: ['pnpm', 'run', 'audit'],
    tolerate: {
      pattern: REGISTRY_UNREACHABLE,
      note: '⚠️  pnpm audit could not reach the registry; skipping (CI enforces).',
    },
  },
];
