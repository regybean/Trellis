/**
 * Ingest progress stream — pure-core unit tests.
 *
 * `encodeProgress` is the producer's pure inverse of `decodeProgress`: both are
 * typed off the one shared `ingestProgressEventSchema`. Encoding an event to its
 * flat Redis field record and decoding it back must round-trip to the same event
 * — that identity is the whole point of a single producer + single consumer, so a
 * wire-shape drift on either side fails here. No Redis I/O; the seam is pure (the
 * stateful `xAddWithTtl` side and the flat-array fold are covered by the
 * durable-stream primitive's own tests in `@acme/redis`).
 */
import { describe, expect, it } from 'vitest';

import type { IngestProgressEvent } from '../../../api/schemas/ingest-progress-schema';
import {
  decodeProgress,
  encodeProgress,
} from '../../../api/services/ingest-progress-stream';

const base = { jobId: 'job-1', uploadId: 'up-1', filename: 'report.pdf' };

describe('encodeProgress ⇄ decodeProgress round-trip', () => {
  it.each<IngestProgressEvent>([
    { ...base, stage: 'queued' },
    { ...base, stage: 'parsing' },
    { ...base, stage: 'embedding' },
    { ...base, stage: 'done' },
    { ...base, stage: 'failed', error: 'unparseable document' },
  ])('encodes %o to a record decoded back identically', (event) => {
    expect(decodeProgress(encodeProgress(event))).toEqual(event);
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

describe('decodeProgress', () => {
  it('throws on a stage typo rather than dropping the event', () => {
    // A producer typo (`stage: 'parsng'`) must be rejected at parse time — the
    // discriminated union has no such member, so validation fails loudly.
    expect(() =>
      decodeProgress({
        jobId: 'j',
        uploadId: 'u',
        filename: 'f',
        stage: 'parsng',
      }),
    ).toThrow();
  });

  it('throws when stage is absent', () => {
    expect(() =>
      decodeProgress({ jobId: 'j', uploadId: 'u', filename: 'f' }),
    ).toThrow();
  });

  it('throws when a failed event omits its error', () => {
    expect(() =>
      decodeProgress({
        jobId: 'j',
        uploadId: 'u',
        filename: 'f',
        stage: 'failed',
      }),
    ).toThrow();
  });
});
