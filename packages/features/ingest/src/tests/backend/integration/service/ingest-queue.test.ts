/**
 * enqueueIngestJob — service (integration) test.
 *
 * The sole enqueuer, against a real BullMQ queue (testcontainer Redis). Asserts
 * the two contract knobs the ticket pins: `jobId` dedup (one job per batch even
 * on a repeat enqueue) and NO auto-retry (no `attempts`/`backoff`).
 */

import { beforeEach, describe, expect, it } from 'vitest';

import type { IngestJob } from '../../../../api/services/ingest-queue';
import {
  _ingestQueue,
  enqueueIngestJob,
} from '../../../../api/services/ingest-queue';

const baseJob = (jobId: string): IngestJob => ({
  jobId,
  userId: 'user-queue',
  uploads: [
    { uploadId: 'u1', filename: 'a.pdf', s3Key: `uploads/${jobId}/u1/a.pdf` },
  ],
});

describe('enqueueIngestJob', () => {
  beforeEach(async () => {
    await _ingestQueue.obliterate({ force: true });
  });

  it('enqueues one job per batch keyed on jobId', async () => {
    const jobId = crypto.randomUUID();
    await enqueueIngestJob(baseJob(jobId));

    const job = await _ingestQueue.getJob(jobId);
    expect(job?.id).toBe(jobId);
    expect(await _ingestQueue.getWaitingCount()).toBe(1);
  });

  it('dedups a repeat enqueue of the same jobId (no duplicate job)', async () => {
    const jobId = crypto.randomUUID();
    await enqueueIngestJob(baseJob(jobId));
    await enqueueIngestJob(baseJob(jobId));

    expect(await _ingestQueue.getWaitingCount()).toBe(1);
  });

  it('sets no auto-retry (no attempts/backoff)', async () => {
    const jobId = crypto.randomUUID();
    await enqueueIngestJob(baseJob(jobId));

    const job = await _ingestQueue.getJob(jobId);
    // No `attempts`/`backoff` set ⇒ BullMQ runs the job once and never retries
    // (attempts defaults to 0/1 depending on version; either means "run once").
    expect(job?.opts.attempts ?? 0).toBeLessThan(2);
    expect(job?.opts.backoff).toBeUndefined();
  });
});
