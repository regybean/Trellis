import { z } from 'zod/v4';

// The per-file progress wire shape — the one contract the writer (producer) and
// the reader/parser (consumer) share. A discriminated union on `stage` over the
// base identity `{ jobId, dataSourceId, uploadId, filename }`; `stage` is ALWAYS present, so a
// producer typo (`stage: 'parsng'`) is rejected at parse time rather than read as
// a silently-dropped event. `uploading` never appears here — it is client-owned
// (browser→S3 PUT), unobservable by the server. Job-level completion is NOT on
// this stream (it is the notification stream's job); this carries per-file stages
// only. Flat `Record<string,string>` on the wire (see the writer/parser).
// `dataSourceId` is the destination Data Source, one per Job, carried on every
// variant because progress is rendered per Source: the panel shows only the
// batch destined for the Source you are standing in, and every other Source's
// rail row swaps its document count for a spinner. Both readers need the
// destination on the event itself — the stream is per-USER, so an event with no
// destination cannot be placed. It lives on the shared base rather than on each
// variant, so this is one line rather than five.
const base = {
  jobId: z.string().min(1),
  dataSourceId: z.uuid(),
  uploadId: z.string().min(1),
  filename: z.string().min(1),
};

export const ingestProgressEventSchema = z.discriminatedUnion('stage', [
  z.object({ ...base, stage: z.literal('queued') }),
  z.object({ ...base, stage: z.literal('parsing') }),
  z.object({ ...base, stage: z.literal('embedding') }),
  z.object({ ...base, stage: z.literal('done') }),
  z.object({ ...base, stage: z.literal('failed'), error: z.string() }),
]);

export type IngestProgressEvent = z.infer<typeof ingestProgressEventSchema>;

// The server-emitted stages, in forward order. `uploading` is deliberately absent
// (client-owned); the client re-adds it when it derives its own Stage union.
export type IngestStage = IngestProgressEvent['stage'];
