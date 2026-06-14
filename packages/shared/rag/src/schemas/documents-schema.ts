import { jsonb, pgSchema, serial, text, vector } from 'drizzle-orm/pg-core';
import { createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';

import { env } from '../env';

// Embedding dimensions for cohere.embed-english-v3 (see bedrock.ts).
export const EMBED_DIMENSIONS = 1024;

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
// knowledge base stays queryable with Drizzle (listing/deletion). The matching
// migration is generated but marked applied — Mastra owns the actual DDL.
export const documents = ragSchema.table(env.DOCUMENTS_TABLE_NAME, {
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
