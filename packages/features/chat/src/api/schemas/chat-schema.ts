import { relations } from 'drizzle-orm';
import { pgTableCreator } from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';

import { env } from '../../env';
import { messages } from './message-schema';

const createTable = pgTableCreator(
  (name) => `${env.NEXT_PUBLIC_WEBAPP}_${name}`,
);

// Chat Model
export const chats = createTable('chats', (t) => ({
  sessionId: t.uuid().primaryKey().defaultRandom(),
  userId: t.text().notNull(),
  createdAt: t.timestamp().notNull().defaultNow(),
}));

// Define relations for type-safe queries
export const chatRelations = relations(chats, ({ many }) => ({
  messages: many(messages),
}));

export const selectChatSchema = createSelectSchema(chats, {
  sessionId: z.uuid(),
  userId: z.string(),
  createdAt: z.coerce.date(),
});

export type SelectChatSchema = z.infer<typeof selectChatSchema>;

export const insertChatSchema = createInsertSchema(chats, {
  sessionId: z.uuid(),
  userId: z.string(),
})
  .required({
    userId: true,
    sessionId: true,
  })
  .omit({
    createdAt: true,
  });

export type InsertChatSchema = z.infer<typeof insertChatSchema>;

export const ChatRequest = z.object({
  query: z.string().max(10_000, 'Message too long'),
  sessionId: z.uuid(),
});

export const DeleteChatRequest = z.object({
  sessionId: z.uuid(),
});

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type StreamChatEvent =
  | {
      type: 'message';
      acc: string;
      chunk: string;
      ts: string;
      sessionId: string;
    }
  | {
      type: 'done';
      ts: string;
      sessionId: string;
    };
