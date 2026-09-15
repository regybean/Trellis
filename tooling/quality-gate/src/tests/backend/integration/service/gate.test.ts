/**
 * The whole command, driven with stages that are real processes and no part of
 * the real gate.
 *
 * This is the layer the unit suites cannot reach: a spawned process, its output
 * on disk, and the exit code the shell entry point hands back to `pnpm`. It
 * runs `node -e`, so it needs no infra and takes milliseconds — and a failing
 * stage here is a real non-zero exit, which is the contract a consumer's CI
 * depends on.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Stage } from '../../../../stages';
import { runQualityGate } from '../../../../gate';

const passes: Stage = {
  name: 'passes',
  command: ['node', '-e', 'process.stdout.write("all good\\n")'],
};
const fails: Stage = {
  name: 'fails',
  command: ['node', '-e', 'process.stderr.write("boom\\n"); process.exit(3)'],
};

let root = '';

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'quality-gate-'));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Run the gate over a stage list and collect what it printed. */
async function gate(stages: readonly Stage[]) {
  let printed = '';
  const code = await runQualityGate({
    root,
    stages,
    out: {
      write(chunk: string) {
        printed += chunk;
      },
    },
  });

  return { code, printed, log: readFileSync(join(root, LOG), 'utf8') };
}

const LOG = 'logs/quality-gate.log';

describe('the exit code', () => {
  it('is 0 when every stage passed', async () => {
    const { code, printed } = await gate([passes]);

    expect(code).toBe(0);
    expect(printed).toContain('✓ quality-gate passed');
  });

  it('is 1 when a stage failed, whatever code that stage exited with', async () => {
    const { code, printed } = await gate([passes, fails]);

    expect(code).toBe(1);
    expect(printed).toContain('FAIL fails');
    expect(printed).toContain('PASS passes');
    expect(printed).toContain('✗ quality-gate FAILED');
  });

  it('is 1 when the command does not exist at all', async () => {
    const { code, printed } = await gate([
      { name: 'absent', command: ['definitely-not-a-command-here'] },
    ]);

    expect(code).toBe(1);
    expect(printed).toContain('FAIL absent');
  });
});

describe('the assembled log', () => {
  it('captures both streams of every stage, under its own banner', async () => {
    const { log } = await gate([passes, fails]);

    expect(log).toContain('# quality-gate started ');
    expect(log).toContain('━━━━━━━━ passes ━━━━━━━━\nall good\n');
    expect(log).toContain('━━━━━━━━ fails ━━━━━━━━\nboom\n');
  });

  it('is rewritten per run rather than appended to', async () => {
    await gate([passes, fails]);
    const { log } = await gate([passes]);

    expect(log).not.toContain('boom');
  });
});
