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

// A parsed file ready for indexing: its chunks plus the metadata shared by every
// chunk it produced. The shape `dedupeChunks` consumes.
interface ParsedDocument {
  file: File;
  uploadTimestamp: number;
  chunks: { text: string }[];
}

// Collapse chunks to one row per deterministic id: repeated content — within a
// single batch or across re-uploads — derives the same vector_id, so duplicates
// overwrite instead of accumulating. Pure: no DB, no embeddings.
export function dedupeChunks(parsed: ParsedDocument[]) {
  const byId = new Map<string, DocumentMetadata>();
  for (const { file, uploadTimestamp, chunks } of parsed) {
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

/** Parse, chunk, embed and index a batch of files into the knowledge base. */
export async function uploadDocs(files: File[]) {
  await ensureVectorIndex();

  const parsed = await Promise.all(
    files.map(async (file) => {
      const text = await extractText(file);
      if (!text.trim()) {
        throw new Error(`No document could be parsed from file: ${file.name}`);
      }
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
      return { file, uploadTimestamp, chunks };
    }),
  );

  const { ids, metadata } = dedupeChunks(parsed);

  if (ids.length === 0) {
    logger.warn('[Chunked]: No chunks produced; nothing to index.');
    return;
  }

  const { embeddings } = await embedMany({
    model: embedModel,
    values: metadata.map((m) => m.text),
    providerOptions: embedProviderOptions('document'),
  });

  logger.info(`[Chunked]: Indexing ${ids.length} chunk(s).`);

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
