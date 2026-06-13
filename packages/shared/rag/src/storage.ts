import { PostgresStore } from '@mastra/pg';

import { env } from './env';

// Storage backing Mastra Memory (threads/messages/resources), in the app
// database alongside the rest of the application's relational data.
export const postgresStore = new PostgresStore({
  id: 'rag-pg-storage',
  host: env.DB_HOST,
  port: env.DB_PORT,
  database: env.DB_NAME,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
});
