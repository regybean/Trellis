import { MDocument } from '@mastra/rag';
import { embedMany } from 'ai';
import { sql } from 'drizzle-orm';
import { v5 as uuidv5 } from 'uuid';

import { createDb } from '@acme/db';
import { logger } from '@acme/logger';
import { embedModel, embedProviderOptions } from '@acme/models';

import type { DocumentMetadata } from './schemas/documents-schema';
import { env } from './env';
import { extractText } from './parsing';
import { documents } from './schemas/documents-schema';
import { ensureVectorIndex, indexName, pgVector } from './vector';

const TEXT_NODE_NAMESPACE = '3b241101-e2bb-4255-8caf-4136c566a962';

// Deterministic chunk id: identical content from the same file always maps to
// the same vector_id, so re-uploads update in place instead of duplicating.
export function deriveChunkId(text: string, fileName: string) {
  return uuidv5(`${text.trim()}-${fileName}`, TEXT_NODE_NAMESPACE);
}

// The empty/unparseable case, tagged so a caller can classify it as a *content*
// failure (isolate this file, keep the batch green) rather than an infra failure
// that should sink the whole job. Everything else `uploadDoc` throws propagates
// raw.
export class DocumentParseError extends Error {
  constructor(readonly fileName: string) {
    super(`No document could be parsed from file: ${fileName}`);
    this.name = 'DocumentParseError';
  }
}

// A single stage transition emitted by `uploadDoc`. Generic in its stage vocabulary
// so the same reporter shape works for a future `uploadStructuredDoc` with a
// different stage set; `@acme/rag` stays ignorant of the stream / tRPC / uploadId /
// wire shape the caller maps it onto. A plain generic — no conditional-typed attrs.
export type StageReporter<TStage extends string> = (
  stage: TStage,
) => void | Promise<void>;

// The stages `uploadDoc` reports. It emits ONLY these two — `queued` / `done` /
// `failed` are the caller's (the ingest processor owns them).
export type RagUploadStage = 'parsing' | 'embedding';

export interface UploadDocOptions {
  onStage?: StageReporter<RagUploadStage>;
}

// A parsed file ready for indexing: its chunks plus the metadata shared by every
// chunk it produced. The shape `dedupeChunks` consumes.
interface ParsedDocument {
  file: File;
  uploadTimestamp: number;
  chunks: { text: string }[];
}

// Collapse one file's chunks to one row per deterministic id: repeated content —
// within this file or across re-uploads — derives the same vector_id, so duplicates
// overwrite instead of accumulating. Pure: no DB, no embeddings. Single-file (the
// batch fan-out moved up to the ingest processor).
export function dedupeChunks({
  file,
  uploadTimestamp,
  chunks,
}: ParsedDocument) {
  const byId = new Map<string, DocumentMetadata>();
  for (const chunk of chunks) {
    const id = deriveChunkId(chunk.text, file.name);
    byId.set(id, {
      text: chunk.text,
      file_name: file.name,
      upload_timestamp: uploadTimestamp,
      chunk_size: env.CHUNK_SIZE,
      parser: 'officeparser',
    });
  }
  return { ids: [...byId.keys()], metadata: [...byId.values()] };
}

// Drizzle client against the vector database, for direct reads/deletes that
// don't need the vector store (listing and deletion by filename). Module-private
// so callers can't run arbitrary SQL against the knowledge base.
const vdb = createDb({ database: env.DB_VECTOR_NAME });

export interface DocumentFilenameSummary {
  filename: string;
  count: number;
  uploadTimestamp: number;
}

/**
 * Parse, chunk, embed and index ONE file into the knowledge base, reporting its
 * `parsing` / `embedding` transitions through the injected reporter. Idempotent by
 * construction: `dedupeChunks` derives each chunk's id from its content + filename,
 * so a re-upload upserts in place rather than duplicating (no skip-checkpoint).
 * Throws `DocumentParseError` when the file yields no parseable text; any other
 * failure (parse, embed, upsert) propagates raw.
 */
export async function uploadDoc(
  file: File,
  { onStage }: UploadDocOptions = {},
) {
  await ensureVectorIndex();

  await onStage?.('parsing');
  const text = await extractText(file);
  if (!text.trim()) throw new DocumentParseError(file.name);

  const uploadTimestamp = Date.now();
  const doc = MDocument.fromText(text, {
    file_name: file.name,
    upload_timestamp: uploadTimestamp,
    chunk_size: env.CHUNK_SIZE,
    parser: 'officeparser',
  });
  const chunks = await doc.chunk({
    strategy: 'sentence',
    maxSize: env.CHUNK_SIZE,
    overlap: env.CHUNK_OVERLAP,
  });

  const { ids, metadata } = dedupeChunks({ file, uploadTimestamp, chunks });

  if (ids.length === 0) {
    logger.warn(
      { fileName: file.name },
      '[Chunked]: No chunks produced; nothing to index.',
    );
    return;
  }

  await onStage?.('embedding');
  const { embeddings } = await embedMany({
    model: embedModel,
    values: metadata.map((m) => m.text),
    providerOptions: embedProviderOptions('document'),
  });

  logger.info(`[Chunked]: Indexing ${ids.length} chunk(s) for ${file.name}.`);

  await pgVector.upsert({ indexName, ids, vectors: embeddings, metadata });
}

/** List uploaded documents grouped by filename. */
export async function listDocuments() {
  const summaries: DocumentFilenameSummary[] = await vdb
    .select({
      filename: sql<string>`(${documents.metadata} ->> 'file_name')`,
      count: sql<number>`count(*)::integer`,
      uploadTimestamp: sql<number>`max((${documents.metadata} ->> 'upload_timestamp')::double precision)`,
    })
    .from(documents)
    .groupBy(sql`(${documents.metadata} ->> 'file_name')`);
  return summaries;
}

/** Delete all chunks belonging to a given filename. */
export async function deleteByFilename(filename: string) {
  const deleted = await vdb
    .delete(documents)
    .where(sql`(${documents.metadata} ->> 'file_name') = ${filename}`)
    .returning({ id: documents.id });

  logger.info({ filename, deletedCount: deleted.length }, 'Deleted document');
  return { deletedCount: deleted.length, filename };
}
