/**
 * The report, asserted as a function over collected entries.
 *
 * Every shape here used to need a workspace on disk and a vitest per package to
 * produce, because the only way to reach the renderer was to run a collection.
 * Its input is a value now, so the rules that are genuinely about the *report* —
 * what a heading counts, which one disappears, where a stray file is filed —
 * are asserted without spawning anything.
 *
 * Structure only: headings, grouping and counts. The subprocess suite holds the
 * end-to-end contract, and neither asserts a literal block of markdown.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { CollectedSuite } from '../../../render';
import { render } from '../../../render';

const LAYERS = ['platform', 'features'];

const CHAT_DIR = join('/repo', 'packages/features/chat');
const REDIS_DIR = join('/repo', 'packages/platform/redis');

/** A test file in the canonical layout, as `vitest list` reports it. */
const testFile = (dir: string, ...segments: string[]) =>
  join(dir, 'src/tests', ...segments);

const suite = (
  over: Partial<CollectedSuite> &
    Pick<CollectedSuite, 'layer' | 'name' | 'dir'>,
): CollectedSuite => ({ entries: [], ...over });

const collected: CollectedSuite[] = [
  suite({
    layer: 'platform',
    name: '@acme/redis',
    dir: REDIS_DIR,
    entries: [
      {
        name: 'nsKey > namespaces a key',
        file: testFile(REDIS_DIR, 'backend/unit/keys.test.ts'),
      },
      {
        name: 'nsKey > brands the result',
        file: testFile(REDIS_DIR, 'backend/unit/keys.test.ts'),
      },
    ],
  }),
  suite({
    layer: 'features',
    name: '@acme/chat',
    dir: CHAT_DIR,
    entries: [
      {
        name: 'chat.send > persists a message',
        file: testFile(CHAT_DIR, 'backend/integration/api/send.test.ts'),
      },
    ],
  }),
  suite({
    layer: 'features',
    name: '@acme/chat',
    dir: CHAT_DIR,
    entries: [
      {
        name: 'formatTimestamp > renders a relative time',
        file: testFile(CHAT_DIR, 'frontend/unit/format.test.ts'),
      },
    ],
  }),
];

/** The `## `/`### `/`#### ` headings of a report, in printed order. */
function headings(report: string, level: number) {
  const prefix = `${'#'.repeat(level)} `;
  return report
    .split('\n')
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length));
}

describe('render groups what was collected', () => {
  it('reports the layers in the order it was given, skipping empty ones', () => {
    const report = render(collected, {
      layers: ['platform', 'shared', 'features'],
    });
    expect(headings(report, 2).map((h) => h.split(' (')[0])).toEqual([
      'platform',
      'features',
    ]);
  });

  it('gives a package collected on both sides one heading and a group each', () => {
    const report = render(collected, { layers: LAYERS });
    expect(headings(report, 3).map((h) => h.split(' (')[0])).toEqual([
      '@acme/redis',
      '@acme/chat',
    ]);
    expect(headings(report, 4).map((h) => h.split(' (')[0])).toEqual([
      'backend/unit',
      'backend/integration/api',
      'frontend/unit',
    ]);
  });

  it('names the group after the path under src/tests', () => {
    const report = render(collected, { layers: LAYERS });
    expect(report).toContain('#### backend/integration/api (1 test)');
  });

  it('files a test outside src/tests under its directory in the package', () => {
    const stray = suite({
      layer: 'platform',
      name: '@acme/redis',
      dir: REDIS_DIR,
      entries: [
        {
          name: 'legacy > still runs',
          file: join(REDIS_DIR, 'src/legacy/old.test.ts'),
        },
      ],
    });
    expect(render([stray], { layers: LAYERS })).toContain('#### src/legacy');
  });
});

describe('render counts what it printed', () => {
  it('carries a count in every heading, singular for one', () => {
    const report = render(collected, { layers: LAYERS });
    expect(report).toContain('## platform (2 tests)');
    expect(report).toContain('### @acme/chat (2 tests)');
    expect(report).toContain('#### frontend/unit (1 test)');
  });

  it('ends on the total and the number of packages it came from', () => {
    // Four tests across three suites, two of which are the same package.
    expect(render(collected, { layers: LAYERS })).toContain(
      '**Total: 4 tests in 2 packages.**',
    );
  });

  it('reports an empty inventory rather than nothing at all', () => {
    expect(render([], { layers: LAYERS })).toContain(
      '**Total: 0 tests in 0 packages.**',
    );
  });
});

describe('render narrows to the layers and kinds asked for', () => {
  it('keeps only the layer named', () => {
    const report = render(collected, {
      layers: LAYERS,
      filters: { layer: new Set(['frontend']) },
    });
    expect(headings(report, 4).map((h) => h.split(' (')[0])).toEqual([
      'frontend/unit',
    ]);
  });

  it('keeps only the kind named, across both layers', () => {
    const report = render(collected, {
      layers: LAYERS,
      filters: { kind: new Set(['unit']) },
    });
    expect(
      headings(report, 4)
        .map((h) => h.split(' (')[0])
        .sort(),
    ).toEqual(['backend/unit', 'frontend/unit']);
  });

  it('composes the two axes as an intersection', () => {
    const report = render(collected, {
      layers: LAYERS,
      filters: { layer: new Set(['backend']), kind: new Set(['unit']) },
    });
    expect(headings(report, 3).map((h) => h.split(' (')[0])).toEqual([
      '@acme/redis',
    ]);
  });

  it('recounts every heading against what survived', () => {
    const report = render(collected, {
      layers: LAYERS,
      filters: { layer: new Set(['backend']) },
    });
    // chat has one test on each side; under --layer backend it is worth one.
    expect(report).toContain('### @acme/chat (1 test)');
    expect(report).toContain('**Total: 3 tests in 2 packages.**');
  });

  it('drops the heading of a package that keeps nothing', () => {
    const report = render(collected, {
      layers: LAYERS,
      filters: { kind: new Set(['integration']) },
    });
    expect(headings(report, 3).map((h) => h.split(' (')[0])).toEqual([
      '@acme/chat',
    ]);
    expect(report).toContain('**Total: 1 test in 1 packages.**');
  });

  it('excludes a test outside the layout from any explicit filter', () => {
    const stray = suite({
      layer: 'platform',
      name: '@acme/redis',
      dir: REDIS_DIR,
      entries: [
        {
          name: 'legacy > still runs',
          file: join(REDIS_DIR, 'src/legacy/old.test.ts'),
        },
      ],
    });
    const report = render([stray], {
      layers: LAYERS,
      filters: { layer: new Set(['backend']) },
    });
    expect(report).toContain('**Total: 0 tests in 0 packages.**');
  });
});
