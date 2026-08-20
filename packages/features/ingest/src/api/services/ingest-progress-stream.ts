import type { StreamCodec, StreamEntry } from '@acme/redis';
import { createDurableStream, HEAD_CURSOR } from '@acme/redis';

import type { IngestProgressEvent } from '../schemas/ingest-progress-schema';
import { ingestConfig } from '../../config';
import { configContext } from '../../env';
import { ingestProgressKey } from '../ingest-keys';
import { ingestProgressEventSchema } from '../schemas/ingest-progress-schema';

// The per-user progress Stream, on the shared `@acme/redis` durable-stream
// primitive (#196). The primitive owns the transport — the XRANGE poll loop with
// idle backoff, the abort-aware poll `delay`, the exclusive cursor, atomic
// append-with-TTL — that ingest used to hand-copy alongside chat and
// notifications. What stays here is ingest's own: the wire codec (encode/decode
// off the one `ingestProgressEventSchema`) and the fresh-connect cursor-seed
// policy. Config-as-code (ADR 0026).
const config = ingestConfig(configContext);

// A validated event → the flat field record `xAdd` writes. `stage` is always
// emitted; `error` rides only on `failed`. Pure — the inverse of `decodeProgress`,
// so the round-trip is unit-testable without Redis.
export function encodeProgress(event: IngestProgressEvent) {
  const fields: Record<string, string> = {
    jobId: event.jobId,
    uploadId: event.uploadId,
    filename: event.filename,
    stage: event.stage,
  };
  if (event.stage === 'failed') fields.error = event.error;
  return fields;
}

// The inverse of `encodeProgress`: the primitive folds the raw Redis field array
// to a record and hands it here. `stage` is required and must be a known member,
// so a producer typo throws here rather than degrading to a dropped event.
export const decodeProgress = (fields: Record<string, string>) =>
  ingestProgressEventSchema.parse(fields);

const codec: StreamCodec<IngestProgressEvent> = {
  encode: encodeProgress,
  decode: decodeProgress,
};

// One user's durable progress Stream (one stream across ALL their Jobs). Every
// append refreshes a rolling TTL atomically (`xAddWithTtl`), so an abandoned
// Job's stream self-expires; nothing ever deletes the key.
export const ingestProgressStream = (userId: string) =>
  createDurableStream<IngestProgressEvent>({
    key: ingestProgressKey(userId),
    ttlSeconds: config.INGEST_PROGRESS_TTL_SECONDS,
    codec,
  });

// A progress writer bound to one Job of one user. The stream key is per-user, so
// the varying `jobId` is closed over here and stamped into every event — the
// processor's contract stays `queued(uploadId, filename)` etc. Fire-and-forget:
// there is no job-level terminal on this stream (completion is the notification
// stream's job).
export function createIngestProgressWriter(userId: string, jobId: string) {
  const stream = ingestProgressStream(userId);
  const write = (event: IngestProgressEvent) => stream.write(event);

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

export type IngestProgressEntry = StreamEntry<IngestProgressEvent>;

// Page-scoped, always-on tail of a user's progress Stream — the ingest
// cursor-seed policy made concrete. Reconnect resumes from tRPC's `lastEventId`;
// a fresh mount from the snapshot's `lastId` (`sinceId`) so prior in-flight
// progress survives a refresh (snapshot → resume-from-lastId, #194); absent both,
// the stream head. Every branch is a REAL Redis id — there is NO `Date.now()`
// cursor to skew against Redis' clock. No `keepGoing` (never self-closes — the
// stream carries no per-Job terminal) and no `transform` (each stage is discrete).
export function tailIngestProgress(
  userId: string,
  cursor: { lastEventId?: string | null; sinceId?: string | null },
  signal?: AbortSignal,
) {
  const seed = cursor.lastEventId ?? cursor.sinceId ?? HEAD_CURSOR;
  return ingestProgressStream(userId).tail(seed, {
    pollMinMs: config.INGEST_PROGRESS_POLL_MIN_MS,
    pollMaxMs: config.INGEST_PROGRESS_POLL_MAX_MS,
    signal,
  });
}
