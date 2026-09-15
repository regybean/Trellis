/**
 * The shipped table, scheduled with a runner that runs nothing.
 *
 * The scheduler's own suite proves it honours `after`. This one proves the
 * table says what the gate means: that `build` is primed before the two stages
 * that need it, that everything else overlaps, and that the one stage allowed
 * to downgrade a failure downgrades only the failure it is allowed to.
 */
import { describe, expect, it } from 'vitest';

import { runSchedule } from '../../../schedule';
import { QUALITY_GATE_STAGES, tolerated } from '../../../stages';

describe('the gate table', () => {
  it('primes build first and starts everything else alongside it', async () => {
    // A runner that settles nothing until it is told to: two stages
    // overlapping is only observable as "both started, neither finished".
    const started: string[] = [];
    const pending = new Map<string, () => void>();
    const schedule = runSchedule(QUALITY_GATE_STAGES, async (stage) => {
      started.push(stage.name);
      await new Promise<void>((resolve) => pending.set(stage.name, resolve));
      return { code: 0, output: '' };
    });
    const finish = async (name: string) => {
      pending.get(name)?.();
      await new Promise((resolve) => setImmediate(resolve));
    };

    await new Promise((resolve) => setImmediate(resolve));

    // Everything started while `build` is still running — except the two
    // stages that follow it, which is the whole of the table's ordering.
    expect(started).toContain('build');
    expect(started).toContain('check:exports');
    expect(started).toContain('audit');
    expect(started).not.toContain('turbo');
    expect(started).not.toContain('test');

    await finish('build');
    expect(started).toContain('turbo');
    expect(started).toContain('test');

    for (const stage of QUALITY_GATE_STAGES) await finish(stage.name);
    const results = await schedule;

    expect(results.map((result) => result.stage.name)).toEqual(
      QUALITY_GATE_STAGES.map((stage) => stage.name),
    );
  });

  it('runs the audit through `pnpm run audit`, so a suppression cannot pin it red', () => {
    const audit = QUALITY_GATE_STAGES.find((stage) => stage.name === 'audit');

    expect(audit?.command).toEqual(['pnpm', 'run', 'audit']);
  });
});

describe('a tolerated failure', () => {
  const audit = QUALITY_GATE_STAGES.find((stage) => stage.name === 'audit') ?? {
    name: 'audit',
    command: [],
  };

  it('passes an unreachable registry, and says in the log why it is green', () => {
    const outcome = tolerated(audit, {
      code: 1,
      output:
        'request to https://registry.example/x failed, reason: ENOTFOUND\n',
    });

    expect(outcome.code).toBe(0);
    expect(outcome.output).toContain(
      'pnpm audit could not reach the registry; skipping (CI enforces).',
    );
  });

  it('still fails a registry that answered with advisories', () => {
    const outcome = tolerated(audit, {
      code: 1,
      output: '1 vulnerabilities found\nSeverity: 1 high\n',
    });

    expect(outcome).toEqual({
      code: 1,
      output: '1 vulnerabilities found\nSeverity: 1 high\n',
    });
  });

  it('leaves a stage that declares no tolerance alone', () => {
    const outcome = tolerated(
      { name: 'boundaries', command: ['pnpm', 'boundaries'] },
      { code: 1, output: 'network' },
    );

    expect(outcome.code).toBe(1);
  });
});
