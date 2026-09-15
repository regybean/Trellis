/**
 * The scheduler, driven with stages that run nothing.
 *
 * Every claim the gate makes about how it runs — what it reports, what overlaps
 * what, what waits, and what a failure does to the rest — is a claim about this
 * function and is asserted here against a fake runner. Nothing in this file
 * starts a real stage, which is the whole reason the stage table is data.
 */
import { describe, expect, it } from 'vitest';

import type { StageRunner } from '../../../schedule';
import type { Stage, StageOutcome } from '../../../stages';
import { runSchedule } from '../../../schedule';

/** A stage that names a command nothing will run. */
function stage(name: string, after: readonly string[] = []): Stage {
  return { name, command: ['false'], after };
}

describe('the report is in declaration order', () => {
  it('reports stages in the order the table declares, not the order they finish', async () => {
    const stages = [stage('first'), stage('second'), stage('third')];
    const delays = new Map([
      ['first', 30],
      ['second', 0],
      ['third', 15],
    ]);

    const results = await runSchedule(stages, async (target) => {
      await new Promise((resolve) =>
        setTimeout(resolve, delays.get(target.name) ?? 0),
      );
      return { code: 0, output: '' };
    });

    expect(results.map((result) => result.stage.name)).toEqual([
      'first',
      'second',
      'third',
    ]);
  });
});

/**
 * A runner that never settles a stage until it is told to, and records the
 * order stages were started in.
 *
 * Two stages overlapping is only observable as "both started, neither
 * finished", so a runner that resolves on its own can't be used to see it.
 */
function controlledRunner() {
  const started: string[] = [];
  const pending = new Map<string, (outcome: StageOutcome) => void>();

  const run: StageRunner = (target) => {
    started.push(target.name);
    return new Promise<StageOutcome>((resolve) => {
      pending.set(target.name, resolve);
    });
  };

  /** Settle a started stage and let the scheduler react to it. */
  const finish = async (name: string, code = 0, output = '') => {
    pending.get(name)?.({ code, output });
    pending.delete(name);
    await new Promise((resolve) => setImmediate(resolve));
  };

  return { run, started, finish };
}

describe('what runs at the same time', () => {
  it('starts every independent stage at once rather than one after another', async () => {
    const { run, started, finish } = controlledRunner();
    const stages = [stage('one'), stage('two'), stage('three')];

    const schedule = runSchedule(stages, run);
    await new Promise((resolve) => setImmediate(resolve));

    expect(started).toEqual(['one', 'two', 'three']);

    await finish('one');
    await finish('two');
    await finish('three');
    await schedule;
  });

  it('holds a stage back until the one it follows has settled', async () => {
    const { run, started, finish } = controlledRunner();
    const stages = [
      stage('checks'),
      stage('build'),
      stage('turbo', ['build']),
      stage('test', ['build']),
    ];

    const schedule = runSchedule(stages, run);
    await new Promise((resolve) => setImmediate(resolve));

    expect(started).toEqual(['checks', 'build']);

    await finish('build');
    expect(started).toEqual(['checks', 'build', 'turbo', 'test']);

    await finish('checks');
    await finish('turbo');
    await finish('test');
    await schedule;
  });
});

describe('what a failure does to the rest', () => {
  it('runs every stage and reports every failure, rather than stopping at the first', async () => {
    const stages = [stage('one'), stage('two'), stage('three'), stage('four')];
    const failing = new Set(['one', 'three']);

    const results = await runSchedule(stages, (target) =>
      Promise.resolve({ code: failing.has(target.name) ? 2 : 0, output: '' }),
    );

    expect(results.map((result) => [result.stage.name, result.code])).toEqual([
      ['one', 2],
      ['two', 0],
      ['three', 2],
      ['four', 0],
    ]);
  });

  it('releases a stage whose predecessor failed — `after` is an order, not a condition', async () => {
    const { run, started, finish } = controlledRunner();
    const stages = [stage('build'), stage('turbo', ['build'])];

    const schedule = runSchedule(stages, run);
    await new Promise((resolve) => setImmediate(resolve));
    await finish('build', 1);

    expect(started).toEqual(['build', 'turbo']);

    await finish('turbo');
    await schedule;
  });
});

describe('a table that cannot be scheduled is a diagnostic, not a hang', () => {
  it('refuses a stage following one no stage declares', async () => {
    await expect(
      runSchedule([stage('turbo', ['build'])], () =>
        Promise.resolve({ code: 0, output: '' }),
      ),
    ).rejects.toThrow('follows "build", which no stage declares');
  });

  it('refuses a cycle instead of waiting forever for it', async () => {
    await expect(
      runSchedule([stage('a', ['b']), stage('b', ['a'])], () =>
        Promise.resolve({ code: 0, output: '' }),
      ),
    ).rejects.toThrow('follows itself');
  });
});
