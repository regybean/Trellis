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

## Relationships

- An operator requests **Presigned upload URLs** for one or more files → uploads directly to S3
- The operator then calls `uploadFromS3` with the resulting S3 keys → the server downloads each file, indexes it into the vector store as **Chunks**, then deletes the S3 object
- Deleting a **Document** removes all its **Chunks** from the vector store by filename
- The `list` procedure returns Documents grouped by filename (one row per Document, not per Chunk)

## Design decisions

**Browser-direct S3 upload**: Files are too large to route through Next.js request bodies. The two-step presign → upload → `uploadFromS3` flow keeps the server stateless and avoids timeouts on large PDFs.

**Local parsing via officeparser**: Document text is extracted in-process (`@acme/rag`) rather than through a hosted parsing service — no LlamaParse/LlamaCloud dependency. Indexing (chunk → embed → upsert) runs on Mastra against the Bedrock Cohere embedder.

**All procedures are admin-only**: The knowledge base is operator-managed. There is no user-facing upload path.
