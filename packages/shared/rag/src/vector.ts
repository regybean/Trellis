import { PgVector } from '@mastra/pg';

import { env } from './env';
import { EMBED_DIMENSIONS } from './schemas/documents-schema';

// Name of the knowledge-base index/table. Matches the Drizzle mirror so both
// Mastra and Drizzle address the same table.
export const indexName = `${env.NEXT_PUBLIC_WEBAPP}_${env.DOCUMENTS_TABLE_NAME}`;

// Vector store backing the knowledge base, in the dedicated vector database.
export const pgVector = new PgVector({
  id: 'rag-pg-vector',
  host: env.DB_HOST,
  port: env.DB_PORT,
  database: env.DB_VECTOR_NAME,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
});

let indexReady: Promise<unknown> | null = null;

// Idempotently create the index/table (Mastra runs the DDL; `CREATE ... IF NOT
// EXISTS`). Called before the first upsert so uploads never race the schema.
export function ensureVectorIndex() {
  indexReady ??= pgVector.createIndex({
    indexName,
    dimension: EMBED_DIMENSIONS,
    metric: 'cosine',
  });
  return indexReady;
}
