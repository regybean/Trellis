import { MDocument } from '@mastra/rag';
import { embedMany } from 'ai';
import { sql } from 'drizzle-orm';
import { v5 as uuidv5 } from 'uuid';

import { createDb } from '@acme/db';
import { logger } from '@acme/logger';
import { embedModel, embedProviderOptions } from '@acme/models';

import type { DocumentMetadata } from './schemas/documents-schema';
import { assertDataSourceOwned } from './data-source';
import { env } from './env';
import { extractText } from './parsing';
import { documents, SCOPE_KEYS } from './schemas/documents-schema';
import { ensureVectorIndex, indexName, pgVector } from './vector';

const TEXT_NODE_NAMESPACE = '3b241101-e2bb-4255-8caf-4136c566a962';

/**
 * Where one upload is going: the verified owner and the single Data Source it
 * lands in. One Source per upload, because a chunk belongs to exactly one.
 *
 * Deliberately NOT `DataSourceScope` (the plural, retrieval-side shape). Reading
 * over a set of Sources is the normal case; writing into a set of them is not a
 * thing, and one type covering both would make `dataSourceIds: [a, b]` a
 * type-legal write with no meaning.
 */
export interface UploadScope {
  ownerId: string;
  dataSourceId: string;
}

// Deterministic chunk id. Document identity is (owner_id, data_source_id,
// file_name), so the scope is part of the key: identical content from the same
// file in the same Source always maps to the same vector_id and a re-upload
// updates in place, while the same file uploaded to a second Source derives a
// second id and embeds again. That is the intended reading of "the same file in
// two Sources is two Documents", and it is also the line of code that forces
// the reindex — every id derived before the partition existed is now wrong.
export function deriveChunkId(
  text: string,
  fileName: string,
  { ownerId, dataSourceId }: UploadScope,
) {
  return uuidv5(
    `${ownerId}-${dataSourceId}-${fileName}-${text.trim()}`,
    TEXT_NODE_NAMESPACE,
  );
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
  scope: UploadScope;
}

// Collapse one file's chunks to one row per deterministic id: repeated content —
// within this file or across re-uploads — derives the same vector_id, so duplicates
// overwrite instead of accumulating. Pure: no DB, no embeddings. Single-file (the
// batch fan-out moved up to the ingest processor).
export function dedupeChunks({
  file,
  uploadTimestamp,
  chunks,
  scope,
}: ParsedDocument) {
  const byId = new Map<string, DocumentMetadata>();
  for (const chunk of chunks) {
    const id = deriveChunkId(chunk.text, file.name, scope);
    byId.set(id, {
      text: chunk.text,
      file_name: file.name,
      upload_timestamp: uploadTimestamp,
      chunk_size: env.CHUNK_SIZE,
      parser: 'officeparser',
      // The stamp. Keyed through `SCOPE_KEYS` rather than spelled inline so a
      // rename of either metadata key breaks here as loudly as it breaks the
      // filter that reads them back.
      [SCOPE_KEYS.owner_id]: scope.ownerId,
      [SCOPE_KEYS.data_source_id]: scope.dataSourceId,
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
 * construction: `dedupeChunks` derives each chunk's id from its content + filename
 * + destination scope, so a re-upload into the same Source upserts in place
 * rather than duplicating (no skip-checkpoint). Throws `DocumentParseError` when
 * the file yields no parseable text, `DataSourceOwnershipError` when the
 * destination Source is not the caller's, and any other failure (parse, embed,
 * upsert) propagates raw.
 *
 * `scope` is a POSITIONALLY REQUIRED argument rather than another key in the
 * options bag. Everything in `UploadDocOptions` is optional and `uploadDoc(file)`
 * was a legal call, so scope inside that bag would have inherited its
 * optionality; split out, an unstamped upload fails to compile at every call
 * site. What that buys is not leak prevention — an unstamped chunk has no
 * `owner_id`, fails the filter's first clause and is retrievable by nobody. It
 * prevents silent no-op uploads: files that embed successfully, cost money,
 * appear nowhere and are deletable by nothing.
 */
export async function uploadDoc(
  file: File,
  scope: UploadScope,
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

  const { ids, metadata } = dedupeChunks({
    file,
    uploadTimestamp,
    chunks,
    scope,
  });

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

  // Re-assert ownership AFTER the embed and immediately before the upsert.
  // Checking up front instead would save embedding spend on a Source that was
  // already gone, but it would leave delete-during-embed wide open; checking
  // here covers both, because an embed is the long part of an upload and the
  // window it opens is the one that matters. A residual window survives, where
  // a delete lands between this assert and the upsert below and orphans chunks
  // — unreachable and fail-closed. Deliberately no sweeper job and no Source
  // lock while a Job is in flight: that is real machinery bought for an
  // invisible, harmless residue.
  await assertDataSourceOwned({
    ownerId: scope.ownerId,
    dataSourceIds: [scope.dataSourceId],
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
