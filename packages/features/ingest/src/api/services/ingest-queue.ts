import { createQueue, QUEUE_NAMES } from '@acme/queue';

import { ingestConfig } from '../../config';
import { appEnv } from '../../env';

// BullMQ job-retention counts are config-as-code (ADR 0026).
const config = ingestConfig({ appEnv, isServer: true });

// One BullMQ job per batch (one presign call). `s3Key` is passed explicitly so
// the worker stays dumb — it never re-derives a key from `jobId`/`uploadId`.
export interface IngestJob {
  jobId: string;
  userId: string;
  uploads: { uploadId: string; filename: string; s3Key: string }[];
}

// Singleton queue — module-private. `enqueueIngestJob` is the only call site that
// may add to this queue; the sole-enqueuer constraint is structural (mirrors
// chat's `generationQueue`).
const ingestQueue = createQueue<IngestJob>(QUEUE_NAMES.INGEST);

// The server-minted `jobId` is the BullMQ dedup key: a duplicate enqueue (e.g. a
// manual re-submit of the same presigned batch) collapses to one job. There is
// deliberately NO `attempts`/`backoff` — ingest never auto-retries (failure is
// visibility, not retry); the dedup only guards a manual re-upload.
export const enqueueIngestJob = (job: IngestJob) =>
  ingestQueue.add('ingest', job, {
    jobId: job.jobId,
    removeOnComplete: config.QUEUE_REMOVE_ON_COMPLETE,
    removeOnFail: config.QUEUE_REMOVE_ON_FAIL,
  });

// Exposed for tests: drain or inspect the queue without going through the
// enqueuer. Not exported from the package boundary.
export const _ingestQueue = ingestQueue;
