/**
 * What the gate says when it is done.
 *
 * The summary is the whole user interface of a command that prints nothing for
 * minutes, and an agent greps the assembled log for the stage that failed. Both
 * are a function over the settled results, so the expected text here is a
 * literal — taken from the shell implementation this replaced, which is what
 * makes it an independent source of truth rather than a restatement of the
 * code below it.
 */
import { describe, expect, it } from 'vitest';

import type { Stage, StageResult } from '../../../stages';
import { assembleLog, formatDuration, formatSummary } from '../../../report';

function result(
  name: string,
  code: number,
  ms: number,
  output = '',
  extra: Partial<Stage> = {},
): StageResult {
  return { stage: { name, command: ['true'], ...extra }, code, output, ms };
}

describe('a duration reads at the scale it is', () => {
  it.each([
    [0, '0.00s'],
    [90, '0.09s'],
    [999, '0.99s'],
    [6340, '6.34s'],
    [59_999, '59.99s'],
    [60_000, '1m00s'],
    [123_456, '2m03s'],
    [3_661_000, '61m01s'],
  ])('%ims reads as %s', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });
});

describe('the summary', () => {
  const results = [
    result('build', 0, 6340, '... 12 cached, 30 total ...', { turbo: true }),
    result('check:bank-tokens', 1, 123_456),
  ];

  it('reports every stage, its verdict and its own duration, in table order', () => {
    const summary = formatSummary(results, {
      elapsedMs: 130_000,
      logPath: 'logs/quality-gate.log',
    });

    expect(summary).toContain('\n──────── quality-gate summary ────────\n');
    expect(summary).toContain('  PASS build               6.34s\n');
    expect(summary).toContain('  FAIL check:bank-tokens    2m03s\n');
  });

  it('names the long pole and says why the column does not sum', () => {
    const summary = formatSummary(results, {
      elapsedMs: 130_000,
      logPath: 'logs/quality-gate.log',
    });

    expect(summary).toContain(
      "  slowest: check:bank-tokens (2m03s) — most stages run in parallel, so the column above\n           does not sum to elapsed; only 'build' is serial-before the rest\n  elapsed: 2m10s\n  full log: logs/quality-gate.log\n",
    );
  });

  it('reports the turbo cache breakdown off the stages that go through turbo', () => {
    expect(
      formatSummary(results, {
        elapsedMs: 130_000,
        logPath: 'logs/quality-gate.log',
      }),
    ).toContain('  cache:   12/30 turbo tasks cached (18 ran)\n');
  });

  it('says nothing about the cache when no turbo stage reported one', () => {
    expect(
      formatSummary([result('lint:ws', 0, 10)], {
        elapsedMs: 1000,
        logPath: 'logs/quality-gate.log',
      }),
    ).not.toContain('cache:');
  });

  it('ends on the failure verdict and how to act on it when a stage failed', () => {
    expect(
      formatSummary(results, {
        elapsedMs: 130_000,
        logPath: 'logs/quality-gate.log',
      }),
    ).toContain(
      "  ✗ quality-gate FAILED — grep the failing stage in logs/quality-gate.log\n  (read-only gate: if it's a fixable lint/format issue, run 'pnpm tidy' then re-run)\n",
    );
  });

  it('ends on the pass verdict when every stage passed', () => {
    const summary = formatSummary([result('lint:ws', 0, 10)], {
      elapsedMs: 1000,
      logPath: 'logs/quality-gate.log',
    });

    expect(summary).toContain('  ✓ quality-gate passed\n');
    expect(summary).not.toContain('FAILED');
  });
});

describe('the assembled log', () => {
  it('carries the freshness header and every stage output in table order', () => {
    const log = assembleLog(
      [result('build', 0, 1, 'built it\n'), result('test', 1, 2, 'boom\n')],
      new Date('2026-09-15T11:22:33.444Z'),
    );

    expect(log).toBe(
      [
        '# quality-gate started 2026-09-15T11:22:33Z\n',
        '\n━━━━━━━━ build ━━━━━━━━\n',
        'built it\n',
        '\n━━━━━━━━ test ━━━━━━━━\n',
        'boom\n',
      ].join(''),
    );
  });
});
