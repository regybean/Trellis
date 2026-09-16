import { z } from 'zod/v4';

// Request presigned upload URLs for a set of files, all landing in ONE Data
// Source. The server mints the `jobId` and per-file `uploadId` in the response —
// the client sends only the destination, filename and content-type.
//
// `dataSourceId` is mandatory and has no default. There is no implicit Data
// Source: the first upload forces an explicit create (inline in the dialog,
// with a client-minted id), because an auto-created "My Documents" lets a user
// go their whole life never naming a Source, leaving the partition on paper
// only.
export const getPresignedUrlsSchema = z.object({
  dataSourceId: z.uuid(),
  files: z
    .array(
      z.object({
        filename: z.string().min(1, 'Filename is required'),
        contentType: z.string().min(1, 'Content type is required'),
      }),
    )
    .min(1, 'At least one file is required'),
});
export type GetPresignedUrlsInput = z.infer<typeof getPresignedUrlsSchema>;

// Start the async ingest Job for a batch already uploaded to S3. The client
// echoes back the server-minted ids + `s3Key` from the presign response, plus
// the destination Source. The router validates non-empty, asserts the
// destination is the caller's, and applies a cheap `jobId`-prefix guard on each
// `s3Key` (no HEAD), then enqueues one BullMQ job.
export const startIngestJobSchema = z.object({
  jobId: z.string().min(1),
  dataSourceId: z.uuid(),
  uploads: z
    .array(
      z.object({
        uploadId: z.string().min(1),
        filename: z.string().min(1),
        s3Key: z.string().min(1),
      }),
    )
    .min(1, 'At least one upload is required'),
});
export type StartIngestJobInput = z.infer<typeof startIngestJobSchema>;

// Input to the pure `documents.progress` subscription reader. `lastEventId` is
// populated by tRPC from the SSE `Last-Event-ID` header on a transient
// reconnect. `sinceId` is the client-supplied fresh-mount cursor: the `lastId`
// from `documents.progressSnapshot`, so the tail resumes strictly after the
// snapshot (resume-from-lastId). Both null ⇒ head-replay of the (bounded)
// stream.
export const progressReaderSchema = z.object({
  lastEventId: z.string().nullish(),
  sinceId: z.string().nullish(),
});
export type ProgressReaderInput = z.infer<typeof progressReaderSchema>;

// List the caller's Documents, optionally narrowed to one Data Source. Absent
// `dataSourceId` is the `All documents` roll-up — every Source the caller owns,
// never a global read.
export const listDocumentsSchema = z.object({
  dataSourceId: z.uuid().optional(),
});
export type ListDocumentsInput = z.infer<typeof listDocumentsSchema>;

// Delete one Document. The Source is part of the input because it is part of
// Document identity now: the same filename in two Sources is two Documents, so
// a bare filename would name both.
export const deleteDocumentSchema = z.object({
  dataSourceId: z.uuid(),
  filename: z.string().min(1),
});
export type DeleteDocumentInput = z.infer<typeof deleteDocumentSchema>;
