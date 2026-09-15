/**
 * Running a stage for real: one child process, its two streams captured as one
 * text, and the tolerance its own row allows.
 *
 * This is the only file in the package that starts anything, which is what
 * leaves the schedule and the report assertable as functions over values.
 *
 * The argv is spawned directly rather than through a shell — the table carries
 * argv, so there is no string for a quoting mistake to live in. Stage output is
 * captured rather than streamed: the gate prints nothing until its summary, so
 * fifteen stages writing to one terminal at once would be unreadable, and the
 * assembled log is where the detail is meant to be read.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { StageRunner } from './schedule';
import { tolerated } from './stages';

interface RunnerContext {
  /** The repo root: every stage command is written to run from there. */
  readonly root: string;
  /** Where each stage's own output is kept, for a run that is interrupted. */
  readonly stageDir: string;
}

/** A runner that spawns each stage's command from the repo root. */
export function spawnStages({ root, stageDir }: RunnerContext): StageRunner {
  return (stage) =>
    new Promise((resolve, reject) => {
      const [command, ...args] = stage.command;
      if (command === undefined) {
        reject(new Error(`stage "${stage.name}" declares no command`));
        return;
      }

      const child = spawn(command, args, { cwd: root });
      let output = '';
      const capture = (chunk: Buffer) => {
        output += chunk.toString();
      };
      child.stdout.on('data', capture);
      child.stderr.on('data', capture);

      const settle = (code: number) => {
        const outcome = tolerated(stage, { code, output });
        writeFileSync(join(stageDir, `${stage.name}.log`), outcome.output);
        resolve(outcome);
      };

      // A command that does not exist is a failed stage, not a failed gate:
      // the summary names it like any other failure and the log carries the
      // reason. A signal leaves no exit code, and a killed stage did not pass.
      child.on('error', (error) => {
        output += `${String(error)}\n`;
        settle(1);
      });
      child.on('close', (code) => settle(code ?? 1));
    });
}
