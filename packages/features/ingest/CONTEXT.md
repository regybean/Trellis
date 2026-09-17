# Ingest (`@acme/ingest`)

Feature for managing the signed-in user's own knowledge base. Users upload files into a **Data Source** they own, indexed into the vector store so the chat assistant can answer questions about them.

Every procedure is `protectedProcedure`, owner-scoped. Authorization here is **row ownership, not a role**: there is no admin gate, and a call naming a Data Source is asserted against `data_source` before it does anything. The rest of this document still reads in the operator vocabulary this feature was born in; that sweep belongs with the documents-page rework.

## Language

**Document**:
A file uploaded to the knowledge base. Identified by `(owner_id, data_source_id, file_name)` — the same file in two Data Sources is two Documents, deleted and re-indexed independently. Accepted types: `.pdf`, `.docx` (parsed to text with officeparser) and `.txt` (read natively). Stored in S3 and indexed as one or more chunks in the vector store.
_Avoid_: "file", "attachment", "resource"

**Chunk**:
A fragment of a Document produced during indexing. Multiple chunks share a `filename`. Stored in the vector store. Not directly visible to operators — they manage Documents, not chunks.
_Avoid_: "piece", "segment", "embedding"

**Knowledge base**:
The collection of all indexed Documents available to the chat assistant at query time. Partitioned into **Data Sources**, which `@acme/rag` owns — the entity, the ownership rule and the caps all live there, and every read and write of `data_source` from here goes through its `./server` module. Ingest holds no database client.
_Avoid_: "vector store", "index", "database"

**Job**:
A grouping identity for the 1..N Uploads created by one presign call — the batch submitted together, landing in exactly ONE Data Source, chosen at presign. Identified by a server-minted `jobId` that flows presign → S3 PUT → enqueue. A Job is **derived, never persisted as a row**: there is no stored Job status, and "the Job succeeded/failed" is computed from its Uploads.
_Avoid_: "batch", "task", "run"

**Upload**:
The transient act of processing one file through a Job. Identified by a server-minted per-file `uploadId` (S3 key `uploads/${jobId}/${uploadId}/${filename}` — the per-file id disambiguates same-filename files in one Job). Carries a live **Stage** and can `fail` independently of its siblings. Ephemeral: it exists for the lifetime of processing and disappears once the Job completes. Distinct from a Document — an Upload is the _processing unit_; the Document is its _durable result_, and because Documents are filename-keyed, two Uploads of the same filename yield one Document.
_Avoid_: "file", "upload job", "document" (a Document is the result, not the act)

**Stage**:
The lifecycle position of a single Upload, shown live to the operator:
`uploading → queued → parsing → embedding → done | failed`.

- `uploading` — client-owned (browser→S3 PUT); the only Stage the server never observes.
- `queued` — enqueued, awaiting a worker concurrency slot. The first server-emitted Stage.
- `parsing` — text extraction and chunking, folded; the operator doesn't distinguish them.
- `embedding` — per-file embedding and vector-store upsert, folded.
- `done` / `failed` — terminal per Upload; `failed` carries an error message.

_Avoid_: "status", "step", "phase"

**Presigned upload URL**:
A time-limited S3 PUT URL generated server-side and returned to the browser, allowing the client to upload directly to S3.
_Avoid_: "signed URL", "upload link"

## Relationships

- An operator submits a set of files → one **Job** (`jobId`) grouping one **Upload** (`uploadId`) per file, both server-minted in the presign response
- Each **Upload** is uploaded browser-direct to S3, then processed server-side (parse → chunk → embed → upsert) into **Chunks**, producing or refreshing one filename-keyed **Document**
- Each **Upload** carries its own **Stage**, and reaches `done` or `failed` independently of its siblings
- A **Job** completes when all its Uploads reach a terminal **Stage**; completion emits a single notification `{ jobId, total, succeeded, failed: { uploadId, filename, error }[] }` → one operator-facing toast
- Deleting a **Document** removes all its **Chunks** from the vector store, matched on owner, Data Source and filename — never filename alone, which would now cross Sources
- The `list` procedure returns the caller's Documents grouped by `(data_source_id, file_name)`, each row naming its Data Source — one row per Document, not per Chunk
- Presign is the **authoritative** quota check: it re-counts the destination Source's Documents from the database and rejects the whole batch when `existing + N` would exceed the cap, naming the remaining headroom. The client's own check is advisory

## Decisions

See [`docs/adr/`](docs/adr/).
