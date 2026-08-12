/**
 * ingest-progress-reducer — frontend/unit (ADR 0018).
 *
 * The pure per-file progress state machine (#180, #194): no React, no tRPC.
 * Asserts the merge contract directly — forward-only ranks (advance-if-greater /
 * ignore lower), `failed` absorbing, seed-on-unknown for live server stages, the
 * per-`jobId` completion set, and the snapshot `hydrate` / `retire` reconcilers
 * that make progress survive a refresh and de-duplicate completed files.
 */
import { describe, expect, it } from 'vitest';

import type { IngestProgressEvent } from '../../../api/schemas/ingest-progress-schema';
import type {
  ProgressEvent,
  ProgressState,
} from '../../../hooks/ingest-progress-reducer';
import {
  deriveCompletedJobIds,
  deriveFiles,
  deriveSummary,
  ingestProgressReducer,
  initialProgressState,
} from '../../../hooks/ingest-progress-reducer';

// Fold a sequence of events over a starting state (default: initial).
const runFrom = (
  events: ProgressEvent[],
  start: ProgressState = initialProgressState,
): ProgressState => {
  let state = start;
  for (const event of events) state = ingestProgressReducer(state, event);
  return state;
};

const run = (events: ProgressEvent[]) => runFrom(events);

const presigned = (
  jobId: string,
  uploads: { uploadId: string; filename: string }[],
): ProgressEvent => ({ type: 'presigned', jobId, uploads });

// A live server progress entry now carries the full wire identity (jobId +
// filename) so an unknown uploadId can seed its own row. Defaults keep the
// forward-only tests terse where identity is incidental.
const server = (
  uploadId: string,
  stage: IngestProgressEvent['stage'],
  opts: { jobId?: string; filename?: string; error?: string } = {},
): ProgressEvent => {
  const jobId = opts.jobId ?? 'job-1';
  const filename = opts.filename ?? `${uploadId}.pdf`;
  return stage === 'failed'
    ? {
        type: 'serverStage',
        jobId,
        uploadId,
        filename,
        stage: 'failed',
        error: opts.error ?? 'err',
      }
    : { type: 'serverStage', jobId, uploadId, filename, stage };
};

// A wire snapshot upload (what `documents.progressSnapshot` returns) for `hydrate`.
const wire = (
  uploadId: string,
  stage: IngestProgressEvent['stage'],
  opts: { jobId?: string; filename?: string; error?: string } = {},
): IngestProgressEvent => {
  const jobId = opts.jobId ?? 'job-old';
  const filename = opts.filename ?? `${uploadId}.pdf`;
  return stage === 'failed'
    ? { jobId, uploadId, filename, stage: 'failed', error: opts.error ?? 'e' }
    : { jobId, uploadId, filename, stage };
};

describe('ingestProgressReducer', () => {
  it('seeds one uploading record per file in submission order', () => {
    const state = run([
      presigned('job-1', [
        { uploadId: 'a', filename: 'a.pdf' },
        { uploadId: 'b', filename: 'b.pdf' },
      ]),
    ]);

    const files = deriveFiles(state);
    expect(files.map((f) => f.uploadId)).toEqual(['a', 'b']);
    expect(files.every((f) => f.stage === 'uploading')).toBe(true);
    expect(files[0]?.jobId).toBe('job-1');
  });

  it('is idempotent on a re-dispatched presign (no duplicate rows)', () => {
    const seed = presigned('job-1', [{ uploadId: 'a', filename: 'a.pdf' }]);
    const state = run([seed, seed]);
    expect(deriveFiles(state)).toHaveLength(1);
  });

  it('advances a record only when the stage rank is strictly greater', () => {
    const state = run([
      presigned('job-1', [{ uploadId: 'a', filename: 'a.pdf' }]),
      { type: 'enqueued', uploadIds: ['a'] }, // uploading → queued
      server('a', 'parsing'), // queued → parsing
    ]);
    expect(deriveFiles(state)[0]?.stage).toBe('parsing');
  });

  it('ignores a lower/equal-rank server stage (no regression)', () => {
    const state = run([
      presigned('job-1', [{ uploadId: 'a', filename: 'a.pdf' }]),
      server('a', 'embedding'),
      server('a', 'parsing'), // lower — ignored
      server('a', 'embedding'), // equal — ignored
    ]);
    expect(deriveFiles(state)[0]?.stage).toBe('embedding');
  });

  it('treats optimistic-queued vs real-queued as a no-op overlap', () => {
    const state = run([
      presigned('job-1', [{ uploadId: 'a', filename: 'a.pdf' }]),
      { type: 'enqueued', uploadIds: ['a'] }, // optimistic queued
      server('a', 'queued'), // real queued (equal)
    ]);
    expect(deriveFiles(state)[0]?.stage).toBe('queued');
  });

  it('makes failed absorbing — no later stage revives it', () => {
    const state = run([
      presigned('job-1', [{ uploadId: 'a', filename: 'a.pdf' }]),
      server('a', 'failed', { error: 'boom' }),
      server('a', 'embedding'), // ignored
      server('a', 'done'), // ignored
    ]);
    const file = deriveFiles(state)[0];
    expect(file?.stage).toBe('failed');
    if (file?.stage === 'failed') expect(file.error).toBe('boom');
  });

  it('does not let a stray failure override a done record', () => {
    const state = run([
      presigned('job-1', [{ uploadId: 'a', filename: 'a.pdf' }]),
      server('a', 'done'),
      server('a', 'failed', { error: 'late' }),
    ]);
    expect(deriveFiles(state)[0]?.stage).toBe('done');
  });

  it('seeds a row from a live server stage for an unknown uploadId (#194)', () => {
    // Post-refresh / another-tab Job: the mount never presigned this Upload, but a
    // live stage must still render — the entry carries jobId + filename to seed.
    const state = run([server('x', 'parsing', { filename: 'x.pdf' })]);
    const file = deriveFiles(state)[0];
    expect(file).toMatchObject({
      uploadId: 'x',
      filename: 'x.pdf',
      jobId: 'job-1',
      stage: 'parsing',
    });
  });

  it('ignores unknown-uploadId for local events (only server stages seed)', () => {
    const base = run([
      presigned('job-1', [{ uploadId: 'a', filename: 'a.pdf' }]),
    ]);
    const events: ProgressEvent[] = [
      { type: 'putFailed', uploadId: 'ghost', error: 'x' },
      { type: 'enqueued', uploadIds: ['ghost'] },
      { type: 'enqueueFailed', uploadIds: ['ghost'], error: 'x' },
    ];
    const state = runFrom(events, base);
    expect(state).toBe(base); // same reference — nothing changed
    expect(deriveFiles(state).map((f) => f.uploadId)).toEqual(['a']);
  });

  it('fails a file on putFailed (in-list, carries the error)', () => {
    const state = run([
      presigned('job-1', [{ uploadId: 'a', filename: 'a.pdf' }]),
      { type: 'putFailed', uploadId: 'a', error: 'network' },
    ]);
    const file = deriveFiles(state)[0];
    expect(file?.stage).toBe('failed');
    if (file?.stage === 'failed') expect(file.error).toBe('network');
  });

  it('fails the whole batch on enqueueFailed (no stranded uploading rows)', () => {
    const state = run([
      presigned('job-1', [
        { uploadId: 'a', filename: 'a.pdf' },
        { uploadId: 'b', filename: 'b.pdf' },
      ]),
      { type: 'enqueueFailed', uploadIds: ['a', 'b'], error: 'enqueue down' },
    ]);
    expect(deriveFiles(state).every((f) => f.stage === 'failed')).toBe(true);
  });

  describe('hydrate (cold-mount snapshot seed, #194)', () => {
    it('seeds in-flight + failed rows from the snapshot in order', () => {
      const state = run([
        {
          type: 'hydrate',
          uploads: [
            wire('u1', 'parsing'),
            wire('u2', 'failed', { error: 'x' }),
          ],
        },
      ]);
      const files = deriveFiles(state);
      expect(files.map((f) => f.uploadId)).toEqual(['u1', 'u2']);
      expect(files[0]?.stage).toBe('parsing');
      expect(files[1]).toMatchObject({ stage: 'failed', error: 'x' });
    });

    it('merges forward-only onto a row this mount already authored', () => {
      // The mount optimistically queued u1; the snapshot says it is already
      // parsing — hydrate advances it, never resets it back.
      const state = run([
        presigned('job-old', [{ uploadId: 'u1', filename: 'u1.pdf' }]),
        { type: 'enqueued', uploadIds: ['u1'] }, // optimistic queued
        { type: 'hydrate', uploads: [wire('u1', 'parsing')] },
      ]);
      expect(deriveFiles(state)).toHaveLength(1);
      expect(deriveFiles(state)[0]?.stage).toBe('parsing');
    });

    it('never regresses a row that is already further along', () => {
      const state = run([
        server('u1', 'embedding', { jobId: 'job-old', filename: 'u1.pdf' }),
        { type: 'hydrate', uploads: [wire('u1', 'queued')] }, // stale — ignored
      ]);
      expect(deriveFiles(state)[0]?.stage).toBe('embedding');
    });
  });

  describe('retire (de-duplicate completed files, #194)', () => {
    it('drops done rows of the named jobs, keeps failed + other jobs', () => {
      const state = run([
        presigned('job-1', [
          { uploadId: 'a', filename: 'a.pdf' },
          { uploadId: 'b', filename: 'b.pdf' },
        ]),
        presigned('job-2', [{ uploadId: 'c', filename: 'c.pdf' }]),
        server('a', 'done'),
        server('b', 'failed', { error: 'x' }),
        server('c', 'done', { jobId: 'job-2' }),
        { type: 'retire', jobIds: ['job-1'] },
      ]);
      const files = deriveFiles(state);
      // a (done, job-1) retired; b (failed) stays; c (done, job-2) untouched.
      expect(files.map((f) => f.uploadId)).toEqual(['b', 'c']);
      expect(files.find((f) => f.uploadId === 'b')?.stage).toBe('failed');
    });

    it('is a same-reference no-op when nothing matches', () => {
      const base = run([
        presigned('job-1', [{ uploadId: 'a', filename: 'a.pdf' }]),
        server('a', 'parsing'), // in-flight, not done
      ]);
      const state = ingestProgressReducer(base, {
        type: 'retire',
        jobIds: ['job-1'],
      });
      expect(state).toBe(base);
    });
  });

  describe('deriveSummary', () => {
    it('counts succeeded/failed/inProgress and flags completion', () => {
      const state = run([
        presigned('job-1', [
          { uploadId: 'a', filename: 'a.pdf' },
          { uploadId: 'b', filename: 'b.pdf' },
          { uploadId: 'c', filename: 'c.pdf' },
        ]),
        server('a', 'done'),
        server('b', 'failed', { error: 'x' }),
        // c still uploading
      ]);
      const summary = deriveSummary(deriveFiles(state));
      expect(summary).toEqual({
        total: 3,
        succeeded: 1,
        failed: 1,
        inProgress: 1,
        isComplete: false,
      });
    });

    it('isComplete only once every file is terminal', () => {
      const state = run([
        presigned('job-1', [{ uploadId: 'a', filename: 'a.pdf' }]),
        server('a', 'done'),
      ]);
      expect(deriveSummary(deriveFiles(state)).isComplete).toBe(true);
    });

    it('is not complete with zero files', () => {
      expect(deriveSummary([]).isComplete).toBe(false);
    });
  });

  describe('deriveCompletedJobIds', () => {
    it('includes a job only when all its uploads are terminal', () => {
      const state = run([
        presigned('job-1', [
          { uploadId: 'a', filename: 'a.pdf' },
          { uploadId: 'b', filename: 'b.pdf' },
        ]),
        presigned('job-2', [{ uploadId: 'c', filename: 'c.pdf' }]),
        server('a', 'done'),
        // b still in-flight → job-1 not complete
        server('c', 'failed', { jobId: 'job-2', error: 'x' }),
      ]);
      const completed = deriveCompletedJobIds(deriveFiles(state));
      expect([...completed]).toEqual(['job-2']);
    });

    it('marks a job complete once its last upload settles', () => {
      const state = run([
        presigned('job-1', [
          { uploadId: 'a', filename: 'a.pdf' },
          { uploadId: 'b', filename: 'b.pdf' },
        ]),
        server('a', 'done'),
        server('b', 'failed', { error: 'x' }),
      ]);
      expect([...deriveCompletedJobIds(deriveFiles(state))]).toEqual(['job-1']);
    });
  });
});
