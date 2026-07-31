import { redis } from '@acme/redis';

import type { IngestProgressEvent } from '../schemas/ingest-progress-schema';
import { ingestConfig } from '../../config';
import { appEnv } from '../../env';
import { ingestProgressKey } from '../ingest-keys';

// The producer half of the per-user progress Stream — symmetric to the
// reader/parser. `encodeProgress` is the pure inverse of `parseProgressEntry`:
// both are typed off the one shared `ingestProgressEventSchema`, so a wire-shape
// change is a type-checked two-file edit rather than a hunt across inline `xAdd`
// sites. `createIngestProgressWriter` composes the encoder around the actual
// `xAdd` — it is the SOLE caller of `xAdd` for a user's progress stream and the
// one home of the rolling-TTL rule. Config-as-code (ADR 0026).
const config = ingestConfig({ appEnv, isServer: true });

// A validated event → the flat [k, v, …] field record `xAdd` writes. `stage` is
// always emitted; `error` rides only on `failed`. Pure — the inverse of the
// parser, so the round-trip is unit-testable without Redis.
export function encodeProgress(
  event: IngestProgressEvent,
): Record<string, string> {
  const fields: Record<string, string> = {
    jobId: event.jobId,
    uploadId: event.uploadId,
    filename: event.filename,
    stage: event.stage,
  };
  if (event.stage === 'failed') fields.error = event.error;
  return fields;
}

// A progress writer bound to one Job of one user. The stream key is per-user (one
// stream across all of a user's Jobs), so the varying `jobId` is closed over here
// and stamped into every event — the processor's contract stays `queued(uploadId,
// filename)` etc. Every append refreshes a rolling TTL, so an abandoned Job's
// stream self-expires; nothing ever deletes the key. Fire-and-forget: there is no
// job-level terminal on this stream (completion is the notification stream's job).
export function createIngestProgressWriter(userId: string, jobId: string) {
  const key = ingestProgressKey(userId);

  async function write(event: IngestProgressEvent) {
    await redis.xAdd(key, '*', encodeProgress(event));
    await redis.expire(key, config.INGEST_PROGRESS_TTL_SECONDS);
  }

  return {
    queued: (uploadId: string, filename: string) =>
      write({ jobId, uploadId, filename, stage: 'queued' }),
    stage: (
      uploadId: string,
      filename: string,
      stage: 'parsing' | 'embedding',
    ) => write({ jobId, uploadId, filename, stage }),
    done: (uploadId: string, filename: string) =>
      write({ jobId, uploadId, filename, stage: 'done' }),
    failed: (uploadId: string, filename: string, error: string) =>
      write({ jobId, uploadId, filename, stage: 'failed', error }),
  };
}
