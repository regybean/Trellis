/**
 * Ingest progress snapshot — service (integration) test.
 *
 * Drives the real `readProgressSnapshot` fold against a real Redis Stream, seeded
 * through the real `createIngestProgressWriter`. The fold is ingest's cold-mount
 * seed (#194): the retained per-user stream folded to the latest stage per Upload,
 * filtered to in-flight + `failed` (drop `done`), plus the resume `lastId`. Paired
 * with the reader's resume-from-lastId, this is what makes progress survive a
 * refresh without replaying an hour of completed jobs.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { redis } from '@acme/redis';

import { ingestProgressKey } from '../../../../api/ingest-keys';
import { readProgressSnapshot } from '../../../../api/services/ingest-progress-snapshot';
import { createIngestProgressWriter } from '../../../../api/services/ingest-progress-writer';
import { cleanupTestData } from '../../utils/test-context';

const userId = 'user-1';

describe('readProgressSnapshot (integration)', () => {
  beforeEach(async () => {
    await cleanupTestData();
  });
  afterEach(async () => {
    await cleanupTestData();
  });

  it('is empty with a head cursor when the stream does not exist', async () => {
    const snapshot = await readProgressSnapshot(userId);
    expect(snapshot.uploads).toEqual([]);
    expect(snapshot.lastId).toBe('0-0');
  });

  it('folds to the latest stage per Upload and drops done', async () => {
    const writer = createIngestProgressWriter(userId, 'job-1');
    // u1 runs to completion → dropped (it lives in documents.list).
    await writer.queued('u1', 'a.pdf');
    await writer.stage('u1', 'a.pdf', 'parsing');
    await writer.stage('u1', 'a.pdf', 'embedding');
    await writer.done('u1', 'a.pdf');
    // u2 is mid-flight → kept at its latest stage.
    await writer.queued('u2', 'b.pdf');
    await writer.stage('u2', 'b.pdf', 'parsing');
    // u3 failed → kept (never became a Document).
    await writer.failed('u3', 'c.pdf', 'bad file');

    const snapshot = await readProgressSnapshot(userId);

    const byId = new Map(snapshot.uploads.map((u) => [u.uploadId, u]));
    expect([...byId.keys()].toSorted((a, b) => a.localeCompare(b))).toEqual([
      'u2',
      'u3',
    ]);
    expect(byId.get('u2')).toMatchObject({
      stage: 'parsing',
      filename: 'b.pdf',
    });
    expect(byId.get('u3')).toMatchObject({
      stage: 'failed',
      error: 'bad file',
    });

    // lastId is the id of the last stream entry, so a reader resumes strictly after.
    const entries = await redis.xRange(ingestProgressKey(userId), '-', '+');
    expect(snapshot.lastId).toBe(entries.at(-1)?.[0]);
  });

  it('drops a Job whose every Upload is done (nothing to re-seed)', async () => {
    const writer = createIngestProgressWriter(userId, 'job-done');
    await writer.queued('u1', 'a.pdf');
    await writer.done('u1', 'a.pdf');
    await writer.queued('u2', 'b.pdf');
    await writer.done('u2', 'b.pdf');

    const snapshot = await readProgressSnapshot(userId);
    expect(snapshot.uploads).toEqual([]);
    // A resume cursor still points past the tail, so the live tail delivers no dupes.
    expect(snapshot.lastId).not.toBe('0-0');
  });
});
