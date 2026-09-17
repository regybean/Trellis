import { MDocument } from '@mastra/rag';
import { embedMany } from 'ai';
import { and, eq, sql } from 'drizzle-orm';
import { v5 as uuidv5 } from 'uuid';

import { createDb } from '@acme/db';
import { logger } from '@acme/logger';
import { embedModel, embedProviderOptions } from '@acme/models';

import type { DocumentMetadata } from './schemas/documents-schema';
import { assertDataSourceOwned } from './data-source';
import { env } from './env';
import { extractText } from './parsing';
import {
  documents,
  metadataField,
  SCOPE_KEYS,
} from './schemas/documents-schema';
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
// don't need the vector store (listing, counting and deleting Documents).
// Module-private so callers can't run arbitrary SQL against the knowledge base.
const vdb = createDb({ database: env.DB_VECTOR_NAME });

// One Document: the Source it lives in, its filename, its chunk count and the
// most recent upload that produced it. `dataSourceId` rides on every row rather
// than only on the unscoped read — the `All documents` roll-up needs it to
// resolve a name, and delete needs it to target the right Document.
export interface DocumentSummary {
  dataSourceId: string;
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

/**
 * The owner's Documents, optionally narrowed to one Data Source.
 *
 * Grouped by `(data_source_id, file_name)` because that, with the owner, IS
 * Document identity now — the same file in two Sources is two Documents, so
 * grouping by filename alone would fold them into one row whose chunk count is
 * the sum and whose delete would have no unambiguous target.
 *
 * `owner_id` is in the predicate unconditionally, exactly as it is in the
 * retrieval filter. Narrowing to a Source is scope selection on top of that,
 * never instead of it: an unowned `dataSourceId` reaching here returns nothing
 * rather than someone else's rows. Callers that want a caller-visible rejection
 * assert ownership first.
 *
 * The Source's NAME is not joined here. It lives in `data_source`, in the app
 * database, and this reads the vector mirror — so composing the two is the
 * caller's (`listDataSources` is right beside this on `./server`).
 */
export async function listDocuments({
  ownerId,
  dataSourceId,
}: {
  ownerId: string;
  dataSourceId?: string;
}) {
  const scope = dataSourceId
    ? and(
        eq(metadataField(SCOPE_KEYS.owner_id), ownerId),
        eq(metadataField(SCOPE_KEYS.data_source_id), dataSourceId),
      )
    : eq(metadataField(SCOPE_KEYS.owner_id), ownerId);

  const summaries: DocumentSummary[] = await vdb
    .select({
      dataSourceId: metadataField(SCOPE_KEYS.data_source_id),
      filename: metadataField('file_name'),
      count: sql<number>`count(*)::integer`,
      uploadTimestamp: sql<number>`max((${metadataField('upload_timestamp')})::double precision)`,
    })
    .from(documents)
    .where(scope)
    .groupBy(
      metadataField(SCOPE_KEYS.data_source_id),
      metadataField('file_name'),
    );
  return summaries;
}

/**
 * How many Documents a Source already holds — distinct filenames, not chunks,
 * because the cap counts Documents.
 *
 * This is the authoritative read behind the presign quota check. It is a live
 * count from the database on every call, deliberately: the client's own check
 * is advisory and a direct tRPC call bypasses the UI entirely.
 */
export async function countDocuments({
  ownerId,
  dataSourceId,
}: UploadScope): Promise<number> {
  const [row] = await vdb
    .select({
      count: sql<number>`count(distinct ${metadataField('file_name')})::integer`,
    })
    .from(documents)
    .where(
      and(
        eq(metadataField(SCOPE_KEYS.owner_id), ownerId),
        eq(metadataField(SCOPE_KEYS.data_source_id), dataSourceId),
      ),
    );
  return row?.count ?? 0;
}

/**
 * Delete one Document: every chunk carrying this owner, Source and filename.
 *
 * Takes the whole identity triple rather than a bare filename. Delete-by-
 * filename would now cross Sources, which is the destructive mirror image of a
 * too-broad retrieval filter — and a user who deletes `notes.pdf` from `Work`
 * must not lose the copy in `Personal`.
 */
export async function deleteDocument({
  ownerId,
  dataSourceId,
  fileName,
}: UploadScope & { fileName: string }) {
  const deleted = await vdb
    .delete(documents)
    .where(
      and(
        eq(metadataField(SCOPE_KEYS.owner_id), ownerId),
        eq(metadataField(SCOPE_KEYS.data_source_id), dataSourceId),
        eq(metadataField('file_name'), fileName),
      ),
    )
    .returning({ id: documents.id });

  logger.info(
    { ownerId, dataSourceId, fileName, deletedCount: deleted.length },
    'Deleted document',
  );
  return { deletedCount: deleted.length, fileName };
}
