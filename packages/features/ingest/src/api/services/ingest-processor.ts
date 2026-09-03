import pLimit from 'p-limit';

import type { Job } from '@acme/queue';
import { logger } from '@acme/logger';
import { DocumentParseError, uploadDoc } from '@acme/rag/server';

import type { JobFailure } from './ingest-notify';
import type { IngestJob } from './ingest-queue';
import { env } from '../../env';
import { deleteFilesFromS3, downloadFileFromS3 } from '../../utils/s3-client';
import { notifyJobComplete } from './ingest-notify';
import { createIngestProgressWriter } from './ingest-progress-stream';

// INGEST_CONCURRENCY (fan-out width) + BullMQ retention are authored config (@acme/env ADR 0001).

// A per-Upload outcome on the SETTLED path only. A content failure
// (`DocumentParseError`) is isolated here — it does NOT throw, so the sibling
// Uploads finish and the Job stays green. An INFRA failure is deliberately absent
// from this union: it re-throws out of `processUpload`, surfacing as a rejected
// `allSettled` result the processor re-throws to fail the whole Job loud.
type UploadOutcome =
  | { ok: true; uploadId: string; filename: string }
  | { ok: false; uploadId: string; filename: string; error: string };

type ProgressWriter = ReturnType<typeof createIngestProgressWriter>;

// Process ONE Upload in a `p-limit` slot: download inside the slot (peak memory
// bounded to INGEST_CONCURRENCY, no `downloading` stage), then `uploadDoc` maps
// its `parsing`/`embedding` transitions straight onto the writer. A parse failure
// is a content failure — record `failed`, isolate, return. Anything else is infra:
// record `failed`, then re-throw so the whole Job fails.
async function processUpload(
  writer: ProgressWriter,
  upload: IngestJob['uploads'][number],
) {
  const { uploadId, filename, s3Key } = upload;
  try {
    const { buffer, contentType } = await downloadFileFromS3(s3Key);
    const file = new File([buffer], filename, { type: contentType });

    await uploadDoc(file, {
      onStage: (stage) => writer.stage(uploadId, filename, stage),
    });

    await writer.done(uploadId, filename);
    return { ok: true, uploadId, filename } satisfies UploadOutcome;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writer.failed(uploadId, filename, message);

    if (error instanceof DocumentParseError) {
      return {
        ok: false,
        uploadId,
        filename,
        error: message,
      } satisfies UploadOutcome;
    }
    throw error;
  }
}

async function runIngestJob(job: Job<IngestJob>) {
  const { jobId, userId, uploads } = job.data;
  const writer = createIngestProgressWriter(userId, jobId);
  const limit = pLimit(env.INGEST_CONCURRENCY);

  logger.info(
    { jobId, userId, total: uploads.length },
    'ingest worker: starting',
  );

  // Every Upload is `queued` up front — in the queue awaiting a `p-limit` slot,
  // the first server-observed stage — before any processing begins.
  for (const u of uploads) await writer.queued(u.uploadId, u.filename);

  const results = await Promise.allSettled(
    uploads.map((u) => limit(() => processUpload(writer, u))),
  );

  // A rejected result is an INFRA failure. Fail the whole Job loud (throw →
  // BullMQ failed job), publish NO completion toast, and leave the S3 objects in
  // place for a manual rerun. Siblings have already finished (allSettled).
  const rejected = results.find((r) => r.status === 'rejected');
  if (rejected?.status === 'rejected') {
    logger.error(
      { jobId, err: rejected.reason },
      'ingest worker: infra failure — job failed',
    );
    throw rejected.reason;
  }

  // Settled path: every Upload reached a terminal (done | content-failed). Tally
  // the outcomes for the single completion notification.
  const failed: JobFailure[] = [];
  let succeeded = 0;
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    const outcome = result.value;
    if (outcome.ok) {
      succeeded += 1;
    } else {
      failed.push({
        uploadId: outcome.uploadId,
        filename: outcome.filename,
        error: outcome.error,
      });
    }
  }

  // Fire the completion notification exactly ONCE, on this settled path only.
  await notifyJobComplete(userId, {
    jobId,
    total: uploads.length,
    succeeded,
    failed,
  });

  // Best-effort S3 cleanup — the batch is done, so the objects are no longer
  // needed; a cleanup failure must not turn a green Job red.
  await deleteFilesFromS3(uploads.map((u) => u.s3Key)).catch((error: unknown) =>
    logger.warn({ jobId, error }, 'ingest worker: S3 cleanup failed'),
  );

  logger.info(
    { jobId, succeeded, failed: failed.length },
    'ingest worker: done',
  );
}

// Factory for the BullMQ job processor. Takes NO args — it direct-imports the
// same-package progress writer and the shared `publish` (via `notifyJobComplete`),
// so an app's `worker.ts` wires it with `createWorker(QUEUE_NAMES.INGEST,
// createIngestProcessor())`. Unlike chat's processor there is no injected seam:
// ingest neither refunds credits nor reads entitlements. Fire-and-forget — no
// lock, no abort, no auto-retry.
export function createIngestProcessor() {
  return async function ingestProcessor(job: Job<IngestJob>) {
    return runIngestJob(job);
  };
}
