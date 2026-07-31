/**
 * ingest-progress-reducer — frontend/unit (ADR 0018).
 *
 * The pure per-file progress state machine (#180): no React, no tRPC. Asserts the
 * merge contract directly — forward-only ranks (advance-if-greater / ignore
 * lower), `failed` absorbing, unknown-`uploadId` no-op, every local + server
 * event, and the per-`jobId` completion set.
 */
import { describe, expect, it } from 'vitest';

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

// Fold a sequence of events over the initial state.
const run = (events: ProgressEvent[]): ProgressState =>
  events.reduce(ingestProgressReducer, initialProgressState);

const presigned = (
  jobId: string,
  uploads: { uploadId: string; filename: string }[],
): ProgressEvent => ({ type: 'presigned', jobId, uploads });

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
      { type: 'serverStage', uploadId: 'a', stage: 'parsing' }, // queued → parsing
    ]);
    expect(deriveFiles(state)[0]?.stage).toBe('parsing');
  });

  it('ignores a lower/equal-rank server stage (no regression)', () => {
    const state = run([
      presigned('job-1', [{ uploadId: 'a', filename: 'a.pdf' }]),
      { type: 'serverStage', uploadId: 'a', stage: 'embedding' },
      { type: 'serverStage', uploadId: 'a', stage: 'parsing' }, // lower — ignored
      { type: 'serverStage', uploadId: 'a', stage: 'embedding' }, // equal — ignored
    ]);
    expect(deriveFiles(state)[0]?.stage).toBe('embedding');
  });

  it('treats optimistic-queued vs real-queued as a no-op overlap', () => {
    const state = run([
      presigned('job-1', [{ uploadId: 'a', filename: 'a.pdf' }]),
      { type: 'enqueued', uploadIds: ['a'] }, // optimistic queued
      { type: 'serverStage', uploadId: 'a', stage: 'queued' }, // real queued (equal)
    ]);
    expect(deriveFiles(state)[0]?.stage).toBe('queued');
  });

  it('makes failed absorbing — no later stage revives it', () => {
    const state = run([
      presigned('job-1', [{ uploadId: 'a', filename: 'a.pdf' }]),
      { type: 'serverStage', uploadId: 'a', stage: 'failed', error: 'boom' },
      { type: 'serverStage', uploadId: 'a', stage: 'embedding' }, // ignored
      { type: 'serverStage', uploadId: 'a', stage: 'done' }, // ignored
    ]);
    const file = deriveFiles(state)[0];
    expect(file?.stage).toBe('failed');
    expect(file?.error).toBe('boom');
  });

  it('does not let a stray failure override a done record', () => {
    const state = run([
      presigned('job-1', [{ uploadId: 'a', filename: 'a.pdf' }]),
      { type: 'serverStage', uploadId: 'a', stage: 'done' },
      { type: 'serverStage', uploadId: 'a', stage: 'failed', error: 'late' },
    ]);
    expect(deriveFiles(state)[0]?.stage).toBe('done');
  });

  it('ignores every event for an unknown uploadId', () => {
    const base = run([
      presigned('job-1', [{ uploadId: 'a', filename: 'a.pdf' }]),
    ]);
    const events: ProgressEvent[] = [
      { type: 'serverStage', uploadId: 'ghost', stage: 'parsing' },
      { type: 'putFailed', uploadId: 'ghost', error: 'x' },
      { type: 'enqueued', uploadIds: ['ghost'] },
      { type: 'enqueueFailed', uploadIds: ['ghost'], error: 'x' },
    ];
    const state = events.reduce(ingestProgressReducer, base);
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
    expect(file?.error).toBe('network');
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

  describe('deriveSummary', () => {
    it('counts succeeded/failed/inProgress and flags completion', () => {
      const state = run([
        presigned('job-1', [
          { uploadId: 'a', filename: 'a.pdf' },
          { uploadId: 'b', filename: 'b.pdf' },
          { uploadId: 'c', filename: 'c.pdf' },
        ]),
        { type: 'serverStage', uploadId: 'a', stage: 'done' },
        { type: 'serverStage', uploadId: 'b', stage: 'failed', error: 'x' },
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
        { type: 'serverStage', uploadId: 'a', stage: 'done' },
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
        { type: 'serverStage', uploadId: 'a', stage: 'done' },
        // b still in-flight → job-1 not complete
        { type: 'serverStage', uploadId: 'c', stage: 'failed', error: 'x' },
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
        { type: 'serverStage', uploadId: 'a', stage: 'done' },
        { type: 'serverStage', uploadId: 'b', stage: 'failed', error: 'x' },
      ]);
      expect([...deriveCompletedJobIds(deriveFiles(state))]).toEqual(['job-1']);
    });
  });
});
