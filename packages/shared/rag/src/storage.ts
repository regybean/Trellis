import { PostgresStore } from '@mastra/pg';

import { env } from './env';
import { RAG_SCHEMA } from './vector';

// Storage backing Mastra Memory (threads/messages/resources), in the app
// database alongside the rest of the application's relational data. Namespaced
// to the per-app schema so multiple apps can share one database.
export const postgresStore = new PostgresStore({
  id: 'rag-pg-storage',
  host: env.DB_HOST,
  port: env.DB_PORT,
  database: env.DB_NAME,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  schemaName: RAG_SCHEMA,
});
