import { z } from 'zod/v4';

// Request presigned upload URLs for a set of files. The server mints the `jobId`
// and per-file `uploadId` in the response — the client sends only filename +
// content-type.
export const getPresignedUrlsSchema = z.object({
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
// echoes back the server-minted ids + `s3Key` from the presign response (trusted:
// admin-only). The router validates non-empty + a cheap `jobId`-prefix guard on
// each `s3Key` (no HEAD), then enqueues one BullMQ job.
export const startIngestJobSchema = z.object({
  jobId: z.string().min(1),
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
// populated by tRPC from the SSE `Last-Event-ID` header on a transient reconnect;
// null on a fresh mount (tail-from-now).
export const progressReaderSchema = z.object({
  lastEventId: z.string().nullish(),
});
export type ProgressReaderInput = z.infer<typeof progressReaderSchema>;

export const deleteDocumentSchema = z.object({
  filename: z.string().min(1),
});
export type DeleteDocumentInput = z.infer<typeof deleteDocumentSchema>;
