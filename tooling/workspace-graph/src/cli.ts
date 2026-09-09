/**
 * The convention every repo checker follows: find the repo root, collect what
 * is wrong, then report it and set an exit code accordingly.
 *
 * The three checkers expressed this four ways in three dialects, down to two
 * different failure glyphs, and one of them derived its root from its own file's
 * depth with no argument override — which is both why it could not be aimed at a
 * fixture and why it had no tests. So the root comes from git (a checker that
 * resolves to the wrong directory finds nothing to check and passes while
 * enforcing nothing), an argument overrides it, and the report is a pure
 * function of the collected violations with a thin exit on top.
 */
import { execFileSync } from 'node:child_process';
import { writeSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The repo root, according to git.
 *
 * Asked of git rather than derived from a file's location, so moving a checker
 * between directories cannot change the directory it checks.
 */
export function repoRoot(cwd: string = process.cwd()): string {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
    }).trim();
  } catch {
    throw new Error(`not inside a git repository (looked from ${cwd})`);
  }
}

/**
 * The root a CLI run targets: its first non-flag argument, or the git root.
 *
 * Flags are skipped rather than positionally counted, so a checker's own flags
 * (`--todos`) can be passed with or without a root.
 */
export function resolveRoot(
  args: readonly string[],
  cwd: string = process.cwd(),
): string {
  const rootArg = args.find((arg) => !arg.startsWith('--'));
  return rootArg ? resolve(cwd, rootArg) : repoRoot(cwd);
}

/**
 * What a checker found. Errors fail the run; warnings are reported and do not —
 * the distinction a checker like `check-adrs` makes between a broken link and
 * an honest gap in a sequence.
 */
export interface Violations {
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  error(message: string): void;
  warn(message: string): void;
}

/** A fresh, empty collector. */
export function collectViolations(): Violations {
  const errors: string[] = [];
  const warnings: string[] = [];
  return {
    errors,
    warnings,
    error(message) {
      errors.push(message);
    },
    warn(message) {
      warnings.push(message);
    },
  };
}

export interface ReportOptions {
  /** The checker's own name, as it appears in its failure line. */
  readonly name: string;
  /** What it found. */
  readonly violations: Violations;
  /** The one line printed when nothing is wrong. */
  readonly summary: string;
  /** Where to read the rule, printed under the errors. */
  readonly help?: string;
}

/** A report, before anything is written or exited. */
export interface Report {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

/**
 * The report a set of violations produces — pure, so the shape of a checker's
 * output is assertable without running the checker as a subprocess.
 *
 * Errors go to stderr and set the exit code; the summary goes to stdout only
 * when there are none, so a clean run pipes as one line. Warnings are always
 * reported and never fail.
 */
export function formatReport({
  name,
  violations,
  summary,
  help,
}: ReportOptions): Report {
  const { errors, warnings } = violations;
  const stderr = warnings.map((warning) => `  warn: ${warning}\n`);

  if (errors.length === 0) {
    return { stdout: `${summary}\n`, stderr: stderr.join(''), code: 0 };
  }

  const problems = errors.length === 1 ? 'problem' : 'problems';
  stderr.push(`\n✖ ${name} found ${errors.length} ${problems}:\n\n`);
  for (const error of errors) stderr.push(`  • ${error}\n`);
  if (help) stderr.push(`\n${help}\n`);

  return { stdout: '', stderr: stderr.join(''), code: 1 };
}

/**
 * Write the report and exit with its code — the last line of every checker.
 *
 * Written with `writeSync` rather than `process.stdout.write`. Both streams are
 * pipes whenever a checker runs under `pnpm lint` or into a log, and a write to
 * a pipe is asynchronous — so `process.exit` discards whatever is still queued
 * once the report outgrows the ~64KB buffer. A checker that reports a thousand
 * findings would print the first few hundred and silently drop the rest.
 */
export function reportAndExit(options: ReportOptions): never {
  const { stdout, stderr, code } = formatReport(options);
  if (stderr) writeSync(2, stderr);
  if (stdout) writeSync(1, stdout);
  process.exit(code);
}
