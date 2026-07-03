import { PostgresStore } from '@mastra/pg';

import { env as dbEnv } from '@acme/db/env';

import { RAG_SCHEMA } from './vector';

// Storage backing Mastra Memory (threads/messages/resources), in the app
// database alongside the rest of the application's relational data. Namespaced
// to the per-app schema so multiple apps can share one database.
export const postgresStore = new PostgresStore({
  id: 'rag-pg-storage',
  host: dbEnv.DB_HOST,
  port: dbEnv.DB_PORT,
  database: dbEnv.DB_NAME,
  user: dbEnv.DB_USER,
  password: dbEnv.DB_PASSWORD,
  schemaName: RAG_SCHEMA,
});
