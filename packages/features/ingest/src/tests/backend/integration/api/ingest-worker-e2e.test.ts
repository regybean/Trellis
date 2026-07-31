/**
 * Worker e2e smoke — the async ingest round trip through a *real* BullMQ worker.
 *
 * Where `ingest-processor.test.ts` calls the processor directly, this drains it
 * through `createWorker` — exactly the wiring each app's `apps/<app>/worker.ts`
 * performs. It proves the whole chain:
 *
 *   documents.startIngestJob → job enqueued → worker drains it → per-file stages
 *   on the progress stream → the file indexed → documents.list returns it.
 *
 * S3 is mocked (setup.ts) so `downloadFileFromS3` yields fixed bytes; embeddings
 * are the fake model. Real Postgres + Redis come from testcontainers.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createWorker, QUEUE_NAMES } from '@acme/queue';
import { deleteByFilename, listDocuments } from '@acme/rag/server';
import { redis } from '@acme/redis';

import type { IngestJob } from '../../../../api/services/ingest-queue';
import type { TestContextOptions } from '../../utils/test-context';
import { ingestProgressKey } from '../../../../api/ingest-keys';
import { appRouter } from '../../../../api/root';
import { createIngestProcessor } from '../../../../api/services/ingest-processor';
import { parseProgressEntry } from '../../../../api/services/ingest-progress-parser';
import { _ingestQueue } from '../../../../api/services/ingest-queue';
import { createTestContext } from '../../utils/test-context';

const adminOpts: TestContextOptions = {
  userId: 'user-ingest-e2e',
  role: 'admin',
  tier: 'Basic',
  credits: { remaining: 250, limit: 250, resetAt: Date.now() },
};

const created: string[] = [];
let worker: ReturnType<typeof createWorker<IngestJob>>;

describe('ingest worker (end-to-end via BullMQ)', () => {
  beforeAll(async () => {
    // The backend suite shares one process (isolate: false), so wipe any jobs
    // other files left before this worker goes live — otherwise it would drain a
    // foreign leftover and trip our `failed` listener. Then mirror apps/*/worker.ts.
    await _ingestQueue.obliterate({ force: true });
    worker = createWorker<IngestJob>(
      QUEUE_NAMES.INGEST,
      createIngestProcessor(),
    );
  });

  afterAll(async () => {
    await worker.close();
    await _ingestQueue.obliterate({ force: true });
    for (const name of created.splice(0)) await deleteByFilename(name);
  });

  beforeEach(async () => {
    await _ingestQueue.obliterate({ force: true });
  });

  it('drains a started Job: file indexed, progress reaches done', async () => {
    const filename = `e2e-${crypto.randomUUID()}.txt`;
    created.push(filename);
    const caller = appRouter.createCaller(createTestContext(adminOpts));

    // S3 download/cleanup use the always-on setup.ts defaults (indexable bytes);
    // this e2e asserts the round trip, not the file content.
    const { jobId, uploads } = await caller.documents.getPresignedUploadUrls({
      files: [{ filename, contentType: 'text/plain' }],
    });

    // Resolve/reject only for OUR job — the shared worker may drain a foreign
    // leftover (non-isolated suite), which must not trip this test.
    const drained = new Promise<void>((resolve, reject) => {
      worker.on('completed', (job) => {
        if (job.id === jobId) resolve();
      });
      worker.on('failed', (job, err) => {
        if (job?.id === jobId) reject(err);
      });
    });

    const result = await caller.documents.startIngestJob({
      jobId,
      uploads: uploads.map((u) => ({
        uploadId: u.uploadId,
        filename: u.filename,
        s3Key: u.s3Key,
      })),
    });
    expect(result).toEqual({ jobId });

    await drained;

    // Progress stream ends at done for the Upload.
    const entries = await redis.xRange(
      ingestProgressKey(adminOpts.userId),
      '-',
      '+',
    );
    const stages = entries.map(
      ([, fields]) => parseProgressEntry(fields).stage,
    );
    expect(stages.at(-1)).toBe('done');

    // The document was indexed for real.
    const docs = await listDocuments();
    expect(docs.find((d) => d.filename === filename)?.count).toBeGreaterThan(0);
  }, 30_000);
});
