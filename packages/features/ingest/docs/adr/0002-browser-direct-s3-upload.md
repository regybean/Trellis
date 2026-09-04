# Bytes go browser→S3 direct, and a batch fails per file

**Status:** accepted — the original upload path; its third step reshaped by the
async migration (server #188, client #189)

## Context

An operator submits a set of documents at once, and a single `.pdf` can be tens
of megabytes. Routing those bytes through the app server means the request body
limit, the request timeout, and peak server memory all scale with what the
operator happened to drag onto the page — and the app server has nothing to do
with the bytes, since parse/embed/upsert reads them back out of object storage
anyway.

A batch also fails unevenly. One PUT can be rejected while its siblings succeed,
and the operator needs to know _which_ file failed, not that "the upload failed".

## Decision

**Three steps, and the app server never sees a file body.**

1. `documents.getPresignedUploadUrls` mints the Job identity (`jobId`, one
   `uploadId` per file) and returns a time-limited S3 PUT URL per file.
2. The browser PUTs each file directly to S3, in parallel.
3. `documents.startIngestJob` enqueues one BullMQ job for the batch, keyed on
   `jobId` so the enqueue is idempotent. Parse/chunk/embed/upsert then runs
   off-request in the worker, so even this call returns immediately.

**Failure is per file, and the batch is never abandoned.** The PUTs run under
`Promise.allSettled`: a rejected PUT fails only that file and the rest continue.
Step 3 enqueues **only the successfully-PUT uploads**, which is what keeps the
Job's `total` honest — a file that never reached S3 is not pending, it is failed.
If step 3 itself rejects for the whole batch, the PUT-succeeded files are marked
failed rather than left stranded at `uploading`.

**Presigning disables the SDK's request checksum.** The `S3Client` sets
`requestChecksumCalculation: 'WHEN_REQUIRED'`. AWS SDK >=3.729 otherwise defaults
to `WHEN_SUPPORTED`, which bakes a CRC32 of an **empty** body into the presigned
URL; the browser then PUTs real bytes and S3 rejects the mismatch with a 400
`InvalidRequest`. A browser PUT cannot join the checksum protocol, so the
checksum has to come off. TLS covers transit and the worker re-parses the object
on download.

**No client-callable cleanup.** A failed PUT can leave a partial or orphaned
object under `uploads/${jobId}/${uploadId}/`. There is no delete procedure for
it — orphan reaping is the bucket's retention policy, not the client's job.
Exposing a client-driven delete would mean an admin-authenticated way to remove
arbitrary keys for the sake of garbage.

## Consequences

- **Positive.** Body size and request duration stop being a function of what the
  operator uploaded; the app server holds no file bytes, so it stays stateless
  and horizontally trivial. A 40 MB PDF and a 4 KB text file take the same path.
- **Positive.** One bad file in a batch of twelve costs that file, not the batch.
- **The checksum line is load-bearing and looks like dead config.** Removing
  `requestChecksumCalculation` breaks every direct upload with a 400 that names
  neither the SDK nor the checksum as the cause. It is commented at the
  call site for the same reason.
- **Orphaned objects accumulate without a bucket lifecycle rule.** The repo does
  not configure one — a deploy that omits it pays storage for failed PUTs
  indefinitely.
- **The presigned URL is a capability.** For its lifetime the holder can PUT to
  that exact key. The key embeds the server-minted `jobId`/`uploadId`, so it is
  not guessable, and the URL is short-lived, but it is still a bearer token
  handed to a browser.
