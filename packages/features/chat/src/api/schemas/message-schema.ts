import { relations } from 'drizzle-orm';
import { pgTableCreator } from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';

import { env } from '../../env';
import { chats } from './chat-schema';

const createTable = pgTableCreator(
  (name) => `${env.NEXT_PUBLIC_WEBAPP}_${name}`,
);

// Chat Model
export const messages = createTable('messages', (t) => ({
  id: t.uuid().primaryKey().defaultRandom(),
  sessionId: t
    .uuid()
    .notNull()
    .references(() => chats.sessionId, { onDelete: 'cascade' }),
  role: t.text().$type<'user' | 'assistant'>().notNull(),
  text: t.text().notNull(),
  timestamp: t.timestamp().notNull().defaultNow(),
}));

export const messageRelations = relations(messages, ({ one }) => ({
  chat: one(chats, {
    fields: [messages.sessionId],
    references: [chats.sessionId],
  }),
}));

export const selectMessageSchema = createSelectSchema(messages, {
  id: z.uuid(),
  sessionId: z.uuid(),
  role: z.enum(['user', 'assistant']),
  text: z.string(),
  timestamp: z.coerce.date(),
});

export type SelectMessageSchema = z.infer<typeof selectMessageSchema>;

export const insertMessageSchema = createInsertSchema(messages, {
  sessionId: z.uuid(),
  role: z.enum(['user', 'assistant']),
  text: z.string(),
})
  .required({
    sessionId: true,
    role: true,
    text: true,
  })
  .omit({
    id: true,
    timestamp: true,
  });

export type insertMessageSchema = z.infer<typeof insertMessageSchema>;

export const uiMessageSchema = selectMessageSchema
  .extend({
    loading: z.boolean().optional(),
    error: z.boolean().optional(),
  })
  .partial({
    id: true,
    sessionId: true,
    timestamp: true,
  });

export type Message = z.infer<typeof uiMessageSchema>;
