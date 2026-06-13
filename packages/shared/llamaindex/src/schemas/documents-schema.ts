import { pgTableCreator, vector } from 'drizzle-orm/pg-core';
import { createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';

import { env } from '../env';

// Embedding dimensions for cohere.embed-english-v3 (see embedding-model.ts)
export const EMBED_DIMENSIONS = 1024;

// Generic metadata stored alongside each document chunk.
export interface DocumentMetadata {
  file_name: string;
  upload_timestamp: number;
  chunk_size: number;
  parser: string;
}

const createTable = pgTableCreator(
  (name) => `${env.NEXT_PUBLIC_WEBAPP}_${name}`,
);

export const documents = createTable(env.DOCUMENTS_TABLE_NAME, (t) => ({
  id: t.uuid().primaryKey().defaultRandom(),
  metadata: t.json().$type<DocumentMetadata>().notNull(),
  embeddings: vector('embeddings', { dimensions: EMBED_DIMENSIONS }).notNull(),
  externalId: t.varchar('external_id').notNull(),
  collection: t.varchar().notNull(),
  document: t.text().notNull(),
}));

// No insert schema: rows are written by LlamaIndex, never via drizzle.
export const selectDocumentSchema = createSelectSchema(documents, {
  id: z.uuid('Invalid embedding ID format'),
  metadata: z.object({
    file_name: z.string(),
    upload_timestamp: z.number(),
    chunk_size: z.number(),
    parser: z.string(),
  }),
  embeddings: z.array(z.number()),
  externalId: z.string('Invalid external ID format'),
  collection: z.string('Invalid collection format'),
  document: z.string('Invalid document format'),
});

export type SelectDocument = z.infer<typeof selectDocumentSchema>;
