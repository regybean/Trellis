import { sql } from 'drizzle-orm';
import { jsonb, pgSchema, serial, text, vector } from 'drizzle-orm/pg-core';
import { createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';

import { env as modelsEnv } from '@acme/models/env';

import { env } from '../env';

// Vector dimension of the active embed model — single source of truth lives in
// `@acme/models` (read from `/env`, which imports only zod + `@acme/env`, never
// the package root, so this schema never triggers provider resolution). The
// dimension rides with the selected embed variant (`MODELS_EMBED.dimensions`).
// Switching embed model means changing it and re-pushing the schema.
export const EMBED_DIMENSIONS = modelsEnv.MODELS_EMBED.dimensions;

// Knowledge-base table name. Mastra-owned (PgVector creates it), but the name is
// ours — so it carries the `mastra_` prefix to mark it Mastra-owned, matching the
// `mastra_`-prefix invariant for every Mastra-owned table. Single source of truth
// for both the PgVector index name (vector.ts) and the Drizzle mirror below.
export const KNOWLEDGE_BASE_TABLE = 'mastra_documents';

// Metadata stored alongside each chunk inside Mastra's PgVector `metadata`
// column. `text` holds the chunk content (PgVector has no separate text column);
// the rest mirror the document the chunk came from.
//
// `owner_id` and `data_source_id` are the privacy boundary, carried on the
// chunk itself rather than in a join table — the retrieval filter is metadata,
// so the partition has to be too. Both are stamped at write time and no code
// path can produce a chunk without them (`uploadDoc` takes the scope as a
// required positional argument). An unstamped chunk, were one to exist, fails
// the filter's first clause and is retrievable by nobody.
export interface DocumentMetadata {
  text: string;
  file_name: string;
  upload_timestamp: number;
  chunk_size: number;
  parser: string;
  owner_id: string;
  data_source_id: string;
}

/**
 * The two metadata keys the privacy boundary is written in, named once.
 *
 * The writer's stamp, the retrieval filter, the request-context validator and
 * the cascade's delete predicate all need these key names, they live in
 * different files, and they are *string literals*. Renaming one and missing
 * another is not a type error by default and not a loud failure either: every
 * query matches nothing, fails closed, and reads like "RAG just stopped
 * working" rather than like a bug with a location.
 *
 * So the names are laundered through a mapped type over `DocumentMetadata`.
 * `Pick` fails if the interface no longer has the key, and the mapped type
 * fixes each value to its own key's literal — so a rename is a compile error at
 * the declaration *and* at every `SCOPE_KEYS.…` access, which is the writer,
 * the filter and the validator.
 */
type ScopeKeys = {
  [K in keyof Pick<DocumentMetadata, 'owner_id' | 'data_source_id'>]: K;
};

export const SCOPE_KEYS: ScopeKeys = {
  owner_id: 'owner_id',
  data_source_id: 'data_source_id',
};

// Per-app schema Mastra namespaces its tables under (see vector.ts RAG_SCHEMA).
export const ragSchema = pgSchema(env.NEXT_PUBLIC_WEBAPP);

// Drizzle mirror of the table Mastra's PgVector creates at runtime. Kept so the
// knowledge base stays queryable with Drizzle (listing/deletion). Mastra owns
// the actual DDL; the vector database is not drizzle-kit-managed at all
// ([ADR 0001](../../docs/adr/0001-mastra-rag-and-memory.md)).
export const documents = ragSchema.table(KNOWLEDGE_BASE_TABLE, {
  id: serial('id').primaryKey(),
  vectorId: text('vector_id').notNull().unique(),
  embedding: vector('embedding', { dimensions: EMBED_DIMENSIONS }),
  metadata: jsonb('metadata').$type<DocumentMetadata>(),
});

// `metadata ->> '<key>'`, with the key type-linked to `DocumentMetadata` so a
// rename is a compile error at every predicate rather than a query that quietly
// matches nothing. `sql.raw` is safe here precisely because the argument is a
// compile-time key name off that interface and can never be caller input.
export const metadataField = (key: keyof DocumentMetadata) =>
  sql<string>`(${documents.metadata} ->> ${sql.raw(`'${key}'`)})`;

// The `metadata` column's shape, hand-written because drizzle-zod only knows it
// as `jsonb`. It is the third place the two scope keys are spelled, so it takes
// the same `SCOPE_KEYS` link the writer and the filter do — without it a rename
// leaves the validator quietly accepting rows nothing can retrieve.
//
// Strict about the scope keys rather than tolerant of pre-partition rows: the
// migration for this change is a drop and reindex, so a chunk with no owner is
// a bug rather than legacy data to accommodate.
export const documentMetadataSchema = z.object({
  text: z.string(),
  file_name: z.string(),
  upload_timestamp: z.number(),
  chunk_size: z.number(),
  parser: z.string(),
  [SCOPE_KEYS.owner_id]: z.string().min(1),
  [SCOPE_KEYS.data_source_id]: z.uuid(),
});

export const selectDocumentSchema = createSelectSchema(documents, {
  id: z.number(),
  vectorId: z.string(),
  embedding: z.array(z.number()).nullable(),
  metadata: documentMetadataSchema.nullable(),
});

export type SelectDocument = z.infer<typeof selectDocumentSchema>;
