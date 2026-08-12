import type { IngestProgressEvent } from '../schemas/ingest-progress-schema';
import { ingestProgressEventSchema } from '../schemas/ingest-progress-schema';

// The pure core of the ingest progress reader: turning a raw Redis Stream entry
// into a validated event and computing the resume cursor. No Redis I/O lives here
// — this is the highest pure point of the reader, extracted so a unit test can
// cross the seam with fixtures. `tailIngestProgress` (ingest-progress-reader.ts)
// composes these around the actual `xRange` polling. Symmetric with the writer's
// `encodeProgress`: parse is the inverse of encode, both typed off the one shared
// `ingestProgressEventSchema`.

// A raw Redis Stream entry as ioredis' `xRange` yields it: an `[id, fields]`
// tuple whose fields are a flat [k, v, k, v, ...] array.
export type RawStreamEntry = readonly [id: string, fields: string[]];

// A parsed, validated entry ready to hand to tRPC `tracked()`: the `id` the
// reconnecting client resumes from, and the per-file stage event it carries.
export interface IngestProgressEntry {
  id: string;
  event: IngestProgressEvent;
}

// A Redis Stream entry arrives as a flat [k, v, k, v, ...] field array. We fold it
// back to a record and validate through the shared schema: `stage` is required and
// must be a known member, so a producer typo throws here rather than degrading to
// a dropped event.
export function parseProgressEntry(fields: string[]) {
  const rec: Record<string, string> = {};
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const key = fields[i];
    const value = fields[i + 1];
    if (key !== undefined && value !== undefined) rec[key] = value;
  }
  return ingestProgressEventSchema.parse(rec);
}

// The reader always resumes strictly AFTER its cursor. On a fresh mount the cursor
// is the snapshot's `lastId` (resume-from-lastId, #194); on a transient reconnect
// it is the last-seen entry id from tRPC's `lastEventId`; on an empty stream it is
// the head (`0-0`). Every branch is a real Redis id — no app-clock `Date.now()`.
// `(id` is Redis' exclusive-start syntax, so a resuming reader never re-reads an
// entry it already emitted.
export const rangeStart = (cursor: string) => `(${cursor}`;
