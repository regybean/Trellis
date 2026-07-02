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

**Presigned upload URL**:
A time-limited S3 PUT URL generated server-side and returned to the browser, allowing the client to upload directly to S3 without routing large file payloads through the Next.js server.
_Avoid_: "signed URL", "upload link"
_Gotcha_: the `S3Client` sets `requestChecksumCalculation: 'WHEN_REQUIRED'`. AWS SDK >=3.729 otherwise bakes an empty-body CRC32 into the presigned URL, which the browser's real-body PUT can't satisfy (400 InvalidRequest). Don't remove it.

## Relationships

- An operator requests **Presigned upload URLs** for one or more files → uploads directly to S3
- The operator then calls `uploadFromS3` with the resulting S3 keys → the server downloads each file, indexes it into the vector store as **Chunks**, then deletes the S3 object
- Deleting a **Document** removes all its **Chunks** from the vector store by filename
- The `list` procedure returns Documents grouped by filename (one row per Document, not per Chunk)

## Design decisions

**Browser-direct S3 upload**: Files are too large to route through Next.js request bodies. The two-step presign → upload → `uploadFromS3` flow keeps the server stateless and avoids timeouts on large PDFs.

**Upload protocol lives in a hook**: The three-step client protocol (presign → S3 PUT → index) is a deep module behind `useDocumentUpload` (`src/hooks/`), exposing `{ upload, status, accept }`. Components stay UI-only (see CLAUDE.md). Pure file validation is split into `src/lib/upload-validation.ts` (no React/tRPC — unit-tested directly). One derived `status` (`'idle' | 'uploading'`) replaces the previous doubled `isUploading` state + per-mutation `isPending`.
_Gotcha_: on partial S3-PUT failure the hook aborts before indexing (never indexes a partial Document set) and reports which files failed; objects uploaded before the failure are orphaned in S3 and reaped by the bucket lifecycle rule — there is no client-callable S3 cleanup procedure.

**Local parsing via officeparser**: Document text is extracted in-process (`@acme/rag`) rather than through a hosted parsing service — no LlamaParse/LlamaCloud dependency. Indexing (chunk → embed → upsert) runs on Mastra against the Bedrock Cohere embedder.
_Gotcha_: officeparser must stay an unbundled server-external in each app (`serverExternalPackages: ['officeparser']` in Next; Vite externalizes node_modules for SSR). Its ESM wrapper destructures named exports off the CJS default import; when a bundler resolves that default to `exports.default` (the `OfficeParser` class), `convert` becomes `undefined` → "convert is not a function" at indexing time. Node's native loader resolves it correctly.

**All procedures are admin-only**: The knowledge base is operator-managed. There is no user-facing upload path.
