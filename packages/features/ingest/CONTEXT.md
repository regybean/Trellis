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
A grouping identity for the 1..N Uploads created by one presign call (the batch an operator submits together). Identified by a server-minted `jobId` (returned in the presign response) that flows presign → S3 PUT → enqueue and serves as the BullMQ dedup key (idempotent enqueue). A Job is **derived, never persisted** — there is no stored Job row or status; "the Job succeeded/failed" is computed from its Uploads. It exists only as `jobId` + its Uploads' progress rows in the stream + one completion notification.
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

> **Async streaming migration (server landed — #188; client #189):** the synchronous `uploadFromS3` (server downloaded + `await uploadDocs` inline) is **gone**. The server now mints the Job identity in presign, enqueues one BullMQ `ingest` job per batch (`enqueueIngestJob`), and a worker (`createIngestProcessor`, 2nd `createWorker` in each app's `worker.ts`) processes files under a `p-limit` fan-out — streaming per-Upload stage progress and publishing one completion notification (`ingest.job-complete` via `@acme/notifications`). The **Language** entries for Job / Upload / Stage are the live model. The client hook is still the interim minimal rewire (presign → S3 PUT → `startIngestJob`, one `idle | uploading` status); the live per-file progress reducer + Variant A UI land in #189.

## Design decisions

**Browser-direct S3 upload**: Files are too large to route through Next.js request bodies. The presign → browser PUT → `startIngestJob` flow keeps the server stateless and avoids timeouts on large PDFs; the actual parse/embed/upsert runs off-request in the worker, so even the enqueue request returns immediately.

**Upload protocol lives in a hook**: The client protocol (presign → S3 PUT → `startIngestJob`) is a deep module behind `useDocumentUpload` (`src/hooks/`), exposing `{ upload, status, accept }`. Components stay UI-only (see CLAUDE.md). Pure file validation is split into `src/lib/upload-validation.ts` (no React/tRPC — unit-tested directly). `status` is `'idle' | 'uploading'` — the CLIENT-side phase only (presign + PUTs + enqueue); indexing now runs async in the worker, so `startIngestJob` returns before any file is parsed. Live per-file progress + the completion toast are the subscription's / notification's job (#189).
_Gotcha_: on partial S3-PUT failure the hook aborts before enqueuing (never starts a partial batch) and reports which files failed; objects uploaded before the failure are orphaned in S3 and reaped by the bucket lifecycle rule — there is no client-callable S3 cleanup procedure.

**Local parsing via officeparser**: Document text is extracted in-process (`@acme/rag`) rather than through a hosted parsing service — no LlamaParse/LlamaCloud dependency. Indexing (chunk → embed → upsert) runs on Mastra against the Bedrock Cohere embedder.
_Gotcha_: officeparser must stay an unbundled server-external in each app (`serverExternalPackages: ['officeparser']` in Next; Vite externalizes node_modules for SSR). Its ESM wrapper destructures named exports off the CJS default import; when a bundler resolves that default to `exports.default` (the `OfficeParser` class), `convert` becomes `undefined` → "convert is not a function" at indexing time. Node's native loader resolves it correctly.

**All procedures are admin-only**: The knowledge base is operator-managed. There is no user-facing upload path.

**Per-user progress stream** (async migration, server landed — #188): live per-Upload Stage transitions ride a per-**user** Redis Stream `ingestProgressKey(userId) = nsKey('ingest','progress',userId)` — one stream across all of a user's Jobs, mirroring chat's `keys → writer → parser → reader` split (`src/api/ingest-keys.ts`, `src/api/services/ingest-progress-*.ts`). The wire shape is a zod **discriminated union on `stage`** (`queued|parsing|embedding|done|failed`, `failed` carries `error`) over base `{jobId, uploadId, filename}`; `stage` is always present so a producer typo throws at parse. `uploading` never appears on the wire (client-owned). The **writer** is the sole `xAdd` and stamps a rolling 1h TTL on every append (an abandoned stream self-expires; nothing ever deletes it); `jobId` is closed over at writer creation so the processor codes against `queued(uploadId, filename)` / `stage(…, 'parsing'|'embedding')` / `done` / `failed`. The **reader** `tailIngestProgress` is page-scoped and always-on: **tail-from-now** on a fresh mount (seed cursor `${Date.now()}-0`; an in-app navigate-away-and-back shows blank until the next stage — no cross-mount resume), exclusive `lastEventId` resume only on a transient reconnect, idle poll backoff, closes **only** on abort. **No job-level terminal rides this stream** — the stream alone can't tell "all done" from "worker crashed"; Job completion is owned solely by the notification stream (fire-and-forget). TTL + poll knobs are config-as-code (`config.ts`, ADR 0026).
_Gotcha_: the fresh-mount cursor uses the app server's `Date.now()` while Redis assigns stream ids from its own clock; under clock skew a "tail from now" can briefly replay or drop a boundary entry. Accepted for the feature (a stale stage flickers at worst); the reader integration test pins the mount clock to Redis' own timeline to stay deterministic.
