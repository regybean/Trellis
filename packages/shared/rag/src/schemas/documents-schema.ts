import { jsonb, pgSchema, serial, text, vector } from 'drizzle-orm/pg-core';
import { createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';

import { modelsEnv } from '@acme/models/env';

import { env } from '../env';

// Vector dimension of the active embed model — single source of truth lives in
// `@acme/models` (imported from `/env`, not the package root, so this schema
// never triggers provider resolution). Switching embed model means changing
// EMBED_DIMENSIONS and re-pushing the schema.
export const { EMBED_DIMENSIONS } = modelsEnv();

// Knowledge-base table name. Mastra-owned (PgVector creates it), but the name is
// ours — so it carries the `mastra_` prefix to mark it Mastra-owned, matching the
// `mastra_`-prefix invariant for every Mastra-owned table. Single source of truth
// for both the PgVector index name (vector.ts) and the Drizzle mirror below.
export const KNOWLEDGE_BASE_TABLE = 'mastra_documents';

// Metadata stored alongside each chunk inside Mastra's PgVector `metadata`
// column. `text` holds the chunk content (PgVector has no separate text column);
// the rest mirror the document the chunk came from.
export interface DocumentMetadata {
  text: string;
  file_name: string;
  upload_timestamp: number;
  chunk_size: number;
  parser: string;
}

// Per-app schema Mastra namespaces its tables under (see vector.ts RAG_SCHEMA).
export const ragSchema = pgSchema(env.NEXT_PUBLIC_WEBAPP);

// Drizzle mirror of the table Mastra's PgVector creates at runtime. Kept so the
// knowledge base stays queryable with Drizzle (listing/deletion). Mastra owns the
// actual DDL; the vector database is not drizzle-kit-managed at all (ADR-0002).
export const documents = ragSchema.table(KNOWLEDGE_BASE_TABLE, {
  id: serial('id').primaryKey(),
  vectorId: text('vector_id').notNull().unique(),
  embedding: vector('embedding', { dimensions: EMBED_DIMENSIONS }),
  metadata: jsonb('metadata').$type<DocumentMetadata>(),
});

export const selectDocumentSchema = createSelectSchema(documents, {
  id: z.number(),
  vectorId: z.string(),
  embedding: z.array(z.number()).nullable(),
  metadata: z
    .object({
      text: z.string(),
      file_name: z.string(),
      upload_timestamp: z.number(),
      chunk_size: z.number(),
      parser: z.string(),
    })
    .nullable(),
});

export type SelectDocument = z.infer<typeof selectDocumentSchema>;
