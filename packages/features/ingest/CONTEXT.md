# Ingest (`@acme/ingest`)

Admin-only feature for managing the knowledge base. Operators upload files that are indexed into the vector store so the chat assistant can answer questions about them.

## Language

**Document**:
A file uploaded by an operator to the knowledge base. Identified by its filename. Accepted types: `.pdf`, `.docx` (parsed to text with officeparser) and `.txt` (read natively). Stored in S3 and indexed as one or more chunks in the vector store.
_Avoid_: "file", "attachment", "resource"

**Chunk**:
A fragment of a Document produced during indexing. Multiple chunks share a `filename`. Stored in the vector store. Not directly visible to operators — they manage Documents, not chunks.
_Avoid_: "piece", "segment", "embedding"

**Knowledge base**:
The collection of all indexed Documents available to the chat assistant at query time. Operators build and maintain it via this feature.
_Avoid_: "vector store", "index", "database"

**Job**:
A grouping identity for the 1..N Uploads created by one presign call (the batch an operator submits together). Identified by a server-minted `jobId` (returned in the presign response) that flows presign → S3 PUT → enqueue and serves as the BullMQ dedup key (idempotent enqueue). A Job is **derived, never persisted as a row** — there is no stored Job status; "the Job succeeded/failed" is computed from its Uploads. It exists only as `jobId` + its Uploads' progress rows in the stream + one completion notification. The progress rows ARE the durable store, though (bounded by the stream's 1h TTL): a fresh client mount folds them back to in-flight progress via `documents.progressSnapshot` (#194), so a Job survives a refresh without any Postgres table.
_Avoid_: "batch", "task", "run"

**Upload**:
The transient act of processing one file through a Job. Identified by a server-minted per-file `uploadId` (S3 key `uploads/${jobId}/${uploadId}/${filename}` — the per-file id disambiguates same-filename files in one Job). Carries a live **stage** and can `fail` independently of its siblings. Ephemeral: it exists for the lifetime of processing and disappears once the Job completes. Distinct from a Document — an Upload is the _processing unit_; the Document is its _durable result_.
_Avoid_: "file", "upload job", "document" (a Document is the result, not the act)
_Gotcha_: two Uploads in one Job with the same filename both reach `done` but collapse to a single Document (Documents are filename-keyed via `deriveChunkId`, last write wins). Accepted — uploading two same-named files is degenerate.

**Stage**:
The lifecycle position of a single Upload, shown live to the operator:
`uploading → queued → parsing → embedding → done | failed`.

- `uploading` — client-owned (browser→S3 PUT); the only stage the server never observes.
- `queued` — enqueued, awaiting a worker concurrency slot (`p-limit`). The first server-emitted stage.
- `parsing` — `extractText` + `chunk` (folded; the operator doesn't distinguish them).
- `embedding` — per-file `embedMany` + `pgVector.upsert` (folded; upsert is a fast tail). The domain commits to **per-file** embedding granularity.
- `done` / `failed` — terminal per Upload; `failed` carries an error message.
  _Avoid_: "status" (reserved for the old binary `idle | uploading`), "step", "phase"

**Presigned upload URL**:
A time-limited S3 PUT URL generated server-side and returned to the browser, allowing the client to upload directly to S3 without routing large file payloads through the Next.js server.
_Avoid_: "signed URL", "upload link"
_Gotcha_: the `S3Client` sets `requestChecksumCalculation: 'WHEN_REQUIRED'`. AWS SDK >=3.729 otherwise bakes an empty-body CRC32 into the presigned URL, which the browser's real-body PUT can't satisfy (400 InvalidRequest). Don't remove it.

## Relationships

- An operator submits a set of files → one **Job** (`jobId`) grouping one **Upload** (`uploadId`) per file, both server-minted in the presign response
- Each **Upload** is uploaded browser-direct to S3, then processed server-side (parse → chunk → embed → upsert) into **Chunks**, producing/refreshing one filename-keyed **Document**
- A **Job** completes when all its Uploads reach a terminal **Stage** (`done` / `failed`); completion emits a single notification `{ jobId, total, succeeded, failed: { uploadId, filename, error }[] }` → one operator-facing toast
- Deleting a **Document** removes all its **Chunks** from the vector store by filename
- The `list` procedure returns Documents grouped by filename (one row per Document, not per Chunk)

> **Async streaming migration (landed — server #188, client #189):** the synchronous `uploadFromS3` (server downloaded + `await uploadDocs` inline) is **gone**. The server mints the Job identity in presign, enqueues one BullMQ `ingest` job per batch (`enqueueIngestJob`), and a worker (`createIngestProcessor`, 2nd `createWorker` in each app's `worker.ts`) processes files under a `p-limit` fan-out — streaming per-Upload stage progress and publishing one completion notification (`ingest.job-complete` via `@acme/notifications`). The client tails that progress stream and renders live per-file Stage (Variant A dense rows). The **Language** entries for Job / Upload / Stage are the live model.

## Design decisions

**Browser-direct S3 upload**: Files are too large to route through Next.js request bodies. The presign → browser PUT → `startIngestJob` flow keeps the server stateless and avoids timeouts on large PDFs; the actual parse/embed/upsert runs off-request in the worker, so even the enqueue request returns immediately.

**Upload protocol + live progress live in a hook** (#189): the client protocol (presign → parallel S3 PUTs → one `startIngestJob` per batch) plus the progress subscription are a deep module behind `useDocumentUpload` (`src/hooks/`), exposing the flat surface `{ upload, files, summary, accept, maxFileSizeBytes }`. Per-file state is a **mount-owned `Record<uploadId, PerFileProgress>`** driven by a pure `ingestProgressReducer` (`src/hooks/ingest-progress-reducer.ts`, unit-tested standalone — no `stateRef`/intent triad, unlike chat, because nothing reads state synchronously). This client authors `uploading` (presign→PUT) + optimistic `queued` (on enqueue success); the server authors `parsing`/`embedding`/`done`/`failed` (+ real `queued`) via the subscription. **Forward-only ranks** (`uploading<queued<parsing<embedding<done`) mean a stage only advances to a strictly-greater rank, so reconnect redelivery + the optimistic-vs-real `queued` overlap are safe; `failed` is absorbing. **Survives a refresh** (#194): on mount the hook seeds the reducer from `documents.progressSnapshot` (`hydrate`) then resumes the tail from `snapshot.lastId`; a live entry for an `uploadId` this mount never saw (post-refresh, another tab) **seeds its own row** (seed-on-unknown) rather than being dropped. `files`/`summary`/`completedJobIds` are pure per-render derivations; the two side-effects are (a) the snapshot hydration and (b) on per-Job completion, `invalidateQueries(documents.list)` **plus** `retire` of that Job's `done` rows — so a completed file shows only in the list, never as a duplicate "Done" row. Components stay UI-only — `UploadDocumentsButton` (trigger) and `IngestProgress` (Variant A panel) sit in different DOM parents but share one hook instance via `IngestUploadProvider` (React context), which the app mounts on the documents section (that keeps the subscription page-scoped). Pure file validation stays in `src/lib/upload-validation.ts` (no React/tRPC).
_Toast split_: request-level failures (validation / presign / `startIngestJob` reject) toast; per-file failures (a rejected PUT, a server `failed`) render **in-list**, never toasted; the completion toast is the app-level `ingest.job-complete` notification, not this hook.
_Gotcha_: a batch enqueues **only successfully-PUT** files (a rejected PUT fails just that file and keeps `total` honest); a whole-batch `startIngestJob` reject fails the PUT-succeeded files rather than stranding them at `uploading`. Orphaned S3 objects from a failed PUT are reaped by the bucket lifecycle rule — no client-callable cleanup.

**Local parsing via officeparser**: Document text is extracted in-process (`@acme/rag`) rather than through a hosted parsing service — no LlamaParse/LlamaCloud dependency. Indexing (chunk → embed → upsert) runs on Mastra against the Bedrock Cohere embedder.
_Gotcha_: officeparser must stay an unbundled server-external in each app (`serverExternalPackages: ['officeparser']` in Next; Vite externalizes node_modules for SSR). Its ESM wrapper destructures named exports off the CJS default import; when a bundler resolves that default to `exports.default` (the `OfficeParser` class), `convert` becomes `undefined` → "convert is not a function" at indexing time. Node's native loader resolves it correctly.

**All procedures are admin-only**: The knowledge base is operator-managed. There is no user-facing upload path.

**Per-user progress stream** (async migration, landed — server #188, client #189; refresh-survival #194): live per-Upload Stage transitions ride a per-**user** Redis Stream `ingestProgressKey(userId) = nsKey('ingest','progress',userId)` — one stream across all of a user's Jobs, on the shared `@acme/redis` **durable-stream** primitive (#196): the transport (poll loop, abort-aware `delay`, atomic append-with-TTL) lives in `@acme/redis`, and `src/api/services/ingest-progress-stream.ts` supplies only ingest's own — the wire codec, the writer, and the cursor-seed policy (`ingest-keys.ts` holds the key). The wire shape is a zod **discriminated union on `stage`** (`queued|parsing|embedding|done|failed`, `failed` carries `error`) over base `{jobId, uploadId, filename}`; `stage` is always present so a producer typo throws at parse. `uploading` never appears on the wire (client-owned). The **writer** is the sole appender and stamps a rolling 1h TTL atomically on every append (`xAddWithTtl`; an abandoned stream self-expires; nothing ever deletes it); `jobId` is closed over at writer creation so the processor codes against `queued(uploadId, filename)` / `stage(…, 'parsing'|'embedding')` / `done` / `failed`. Read is two seams: `documents.progressSnapshot` folds the retained stream (`xRange('-','+')`) to the latest stage per Upload — **in-flight + `failed`, dropping `done`** (those live in `documents.list`) — plus a resume `lastId`; then the **reader** `tailIngestProgress` tails from a **real Redis id** — `lastEventId` (transient reconnect) ?? `sinceId` (the snapshot's `lastId`, fresh mount) ?? head (`0-0`) — with idle poll backoff, closing **only** on abort. This is **snapshot → resume-from-lastId** (chat's principle, not its head-replay: replaying an hour of completed jobs would worsen the duplicate). **No job-level terminal rides this stream** — the stream alone can't tell "all done" from "worker crashed"; Job completion is owned solely by the notification stream (fire-and-forget). TTL + poll knobs are authored config in `env.ts`, env-overridable per deploy (ADR 0033). Rationale + the retired tail-from-now model: ADR 0031.
_Fixed (#194)_: the old fresh-mount cursor was `${Date.now()}-0` — the app server's clock, while Redis assigns ids from its own. Under podman-VM clock skew that landed in Redis' future and silently **dropped every real stage event** (the "stuck at queued" symptom). Removing the `Date.now()` cursor entirely (every branch is now a real stream id) makes it structurally unrecurrable; a regression test injects an hour of skew and asserts events still deliver.
