import { HEAD_CURSOR } from '@acme/redis';

import type { IngestProgressEvent } from '../schemas/ingest-progress-schema';
import { ingestProgressStream } from './ingest-progress-stream';

// The server-side fold of a user's retained progress Stream into the seed a fresh
// client mount needs (#194). This is ingest's answer to chat's `chat.get` +
// `chat.inflightTurn` collapsed into one: the durable store is the Stream itself
// (bounded by its 1h TTL, no Postgres table), so folding it to the latest stage
// per Upload is how progress survives a refresh instead of tailing-from-now into a
// blank panel. The full-range read + decode is the durable-stream primitive's
// `read()`; this owns only the fold.

// The latest per-Upload stage still worth showing on a cold mount, plus the resume
// cursor. `uploads` is filtered to in-flight (`queued`/`parsing`/`embedding`) +
// `failed` — `done` Uploads are dropped because they already live in
// `documents.list`, so re-seeding them would duplicate the row. `lastId` is the id
// of the last Stream entry the fold consumed, so the client subscribes strictly
// AFTER it (snapshot → resume-from-lastId, mirroring chat) — no replay, no gap.
export interface ProgressSnapshot {
  uploads: IngestProgressEvent[];
  lastId: string;
}

export async function readProgressSnapshot(userId: string) {
  // A Stream is ordered by ascending id and the writer only ever advances an
  // Upload forward, so folding entry-by-entry with last-write-wins per `uploadId`
  // yields the furthest stage each Upload reached. `HEAD_CURSOR` ('0-0') is the
  // resume cursor for an empty stream: the exclusive `(0-0` start reads everything
  // after the head, never a stale app-clock `Date.now()`.
  const entries = await ingestProgressStream(userId).read();

  const latest = new Map<string, IngestProgressEvent>();
  let lastId = HEAD_CURSOR;
  for (const { id, event } of entries) {
    lastId = id;
    latest.set(event.uploadId, event);
  }

  const uploads = [...latest.values()].filter(
    (event) => event.stage !== 'done',
  );
  return { uploads, lastId } satisfies ProgressSnapshot;
}
