import { jsonb, text, timestamp } from 'drizzle-orm/pg-core';
import { createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';

import { ragSchema } from './documents-schema';

// Drizzle mirrors of the tables Mastra Memory (PostgresStore) creates at runtime
// in the app database. Kept so conversations stay queryable with Drizzle; the
// matching migration is generated but marked applied — Mastra owns the DDL.
// Mastra namespaces these under the per-app schema (see vector.ts RAG_SCHEMA).

export const mastraThreads = ragSchema.table('mastra_threads', {
  id: text('id').primaryKey(),
  resourceId: text('resourceId').notNull(),
  title: text('title').notNull(),
  metadata: jsonb('metadata'),
  createdAt: timestamp('createdAt').notNull(),
  updatedAt: timestamp('updatedAt').notNull(),
});

export const mastraMessages = ragSchema.table('mastra_messages', {
  id: text('id').primaryKey(),
  threadId: text('thread_id').notNull(),
  content: text('content').notNull(),
  role: text('role').notNull(),
  type: text('type').notNull(),
  createdAt: timestamp('createdAt').notNull(),
  resourceId: text('resourceId'),
});

export const mastraResources = ragSchema.table('mastra_resources', {
  id: text('id').primaryKey(),
  workingMemory: text('workingMemory'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('createdAt').notNull(),
  updatedAt: timestamp('updatedAt').notNull(),
});

export const selectThreadSchema = createSelectSchema(mastraThreads, {
  id: z.string(),
  resourceId: z.string(),
  title: z.string(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type SelectThread = z.infer<typeof selectThreadSchema>;
