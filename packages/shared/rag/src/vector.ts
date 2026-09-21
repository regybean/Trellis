import { PgVector } from '@mastra/pg';

import { env as dbEnv } from '@acme/db/env';

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
  host: dbEnv.DB_HOST,
  port: dbEnv.DB_PORT,
  database: env.DB_VECTOR_NAME,
  user: dbEnv.DB_USER,
  password: dbEnv.DB_PASSWORD,
  schemaName: RAG_SCHEMA,
});

let indexReady: Promise<unknown> | null = null;

// Guard against a silent embed-model/index dimension mismatch. The embed model
// fixes EMBED_DIMENSIONS; if an index already exists at a different dimension
// (e.g. someone switched embed provider without rebuilding) every upsert would
// fail deep inside pgvector. Surface an actionable error up front instead.
//
// The remedy names no `db:push`: the vector database is not drizzle-kit-managed
// at all, so there is nothing to push against it and there never was a vector
// push to run. `ensureVectorIndex` below is what recreates the table, at boot.
// The same three steps are the only way to reindex, whatever forced it, so keep
// this string and the reindex entry in the repo's docs quoting each other.
async function assertDimensionMatches() {
  const existing = await pgVector.listIndexes();
  if (!existing.includes(indexName)) return;

  const { dimension } = await pgVector.describeIndex({ indexName });
  if (dimension !== EMBED_DIMENSIONS) {
    throw new Error(
      `Knowledge-base index \`${indexName}\` exists at dimension ${dimension} ` +
        `but EMBED_DIMENSIONS=${EMBED_DIMENSIONS} — the embed model changed. ` +
        `Rebuild it: drop \`${RAG_SCHEMA}.${indexName}\` in the vector database, ` +
        `restart so it is recreated at boot, then re-upload the documents. ` +
        `There is no vector \`db:push\` — Mastra owns this table's DDL.`,
    );
  }
}

// Idempotently create the index/table (Mastra runs the DDL; `CREATE ... IF NOT
// EXISTS`). Called before the first upsert so uploads never race the schema. On
// failure the cached promise is cleared so a transient error (e.g. DB blip) can
// be retried on the next call instead of poisoning every later upload.
export function ensureVectorIndex() {
  indexReady ??= assertDimensionMatches()
    .then(() =>
      pgVector.createIndex({
        indexName,
        dimension: EMBED_DIMENSIONS,
        metric: 'cosine',
      }),
    )
    .catch((error: unknown) => {
      indexReady = null;
      throw error;
    });
  return indexReady;
}
