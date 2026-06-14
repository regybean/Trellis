import { PgVector } from '@mastra/pg';

import { env } from './env';
import {
  EMBED_DIMENSIONS,
  KNOWLEDGE_BASE_TABLE,
} from './schemas/documents-schema';

// Knowledge-base table name within the per-app schema (see RAG_SCHEMA). Matches
// the Drizzle mirror so both Mastra and Drizzle address the same table.
export const indexName = KNOWLEDGE_BASE_TABLE;

// Per-app Postgres schema. Mastra namespaces every table it creates under this
// schema (CREATE SCHEMA IF NOT EXISTS), giving multiple apps clean separation
// inside one database instead of relying on table-name prefixes.
export const RAG_SCHEMA = env.NEXT_PUBLIC_WEBAPP;

// Vector store backing the knowledge base, in the dedicated vector database.
export const pgVector = new PgVector({
  id: 'rag-pg-vector',
  host: env.DB_HOST,
  port: env.DB_PORT,
  database: env.DB_VECTOR_NAME,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  schemaName: RAG_SCHEMA,
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
