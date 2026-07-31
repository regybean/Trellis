/**
 * Ingest progress stream — pure-core unit tests.
 *
 * `encodeProgress` is the producer's pure inverse of the reader's
 * `parseProgressEntry`: both are typed off the one shared
 * `ingestProgressEventSchema`. Encoding an event to its flat Redis field record
 * and parsing it back must round-trip to the same event — that identity is the
 * whole point of a single producer + single consumer, so a wire-shape drift on
 * either side fails here. No Redis I/O; the seam is pure (the stateful
 * `xAdd`/TTL side is covered through the reader integration test).
 */
import { describe, expect, it } from 'vitest';

import type { IngestProgressEvent } from '../../../api/schemas/ingest-progress-schema';
import {
  parseProgressEntry,
  rangeStart,
} from '../../../api/services/ingest-progress-parser';
import { encodeProgress } from '../../../api/services/ingest-progress-writer';

// `xAdd` takes a flat [k, v, …] field array; the reader's `parseProgressEntry`
// consumes the same shape. Flattening the writer's field record is exactly what
// ioredis does on the wire, so this crosses the real producer↔consumer boundary.
const flatten = (record: Record<string, string>) =>
  Object.entries(record).flat();

const base = { jobId: 'job-1', uploadId: 'up-1', filename: 'report.pdf' };

describe('encodeProgress ⇄ parseProgressEntry round-trip', () => {
  it.each<IngestProgressEvent>([
    { ...base, stage: 'queued' },
    { ...base, stage: 'parsing' },
    { ...base, stage: 'embedding' },
    { ...base, stage: 'done' },
    { ...base, stage: 'failed', error: 'unparseable document' },
  ])('encodes %o to a record the parser reads back identically', (event) => {
    expect(parseProgressEntry(flatten(encodeProgress(event)))).toEqual(event);
  });

  it('carries the error field only on a failed event', () => {
    expect(encodeProgress({ ...base, stage: 'parsing' })).toEqual({
      ...base,
      stage: 'parsing',
    });
    expect(encodeProgress({ ...base, stage: 'failed', error: 'boom' })).toEqual(
      { ...base, stage: 'failed', error: 'boom' },
    );
  });
});

describe('parseProgressEntry', () => {
  it('throws on a stage typo rather than dropping the event', () => {
    // A producer typo (`stage: 'parsng'`) must be rejected at parse time — the
    // discriminated union has no such member, so validation fails loudly.
    expect(() =>
      parseProgressEntry([
        'jobId',
        'j',
        'uploadId',
        'u',
        'filename',
        'f',
        'stage',
        'parsng',
      ]),
    ).toThrow();
  });

  it('throws when stage is absent', () => {
    expect(() =>
      parseProgressEntry(['jobId', 'j', 'uploadId', 'u', 'filename', 'f']),
    ).toThrow();
  });

  it('throws when a failed event omits its error', () => {
    expect(() =>
      parseProgressEntry([
        'jobId',
        'j',
        'uploadId',
        'u',
        'filename',
        'f',
        'stage',
        'failed',
      ]),
    ).toThrow();
  });
});

describe('rangeStart', () => {
  it('resumes strictly after the cursor (exclusive)', () => {
    // '(id' is Redis' exclusive-start syntax, so a resuming reader never
    // re-reads the entry it already had. Seeding the cursor to `${now}-0` is how
    // a fresh mount tails from now.
    expect(rangeStart('5-0')).toBe('(5-0');
    expect(rangeStart('1785000000000-0')).toBe('(1785000000000-0');
  });
});
