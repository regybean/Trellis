import { pgSchema, unique } from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';

import { env } from '../../env';

// Message feedback is the first app-owned, Drizzle-managed table in the repo —
// the concrete proof of the ADR-0002 ownership seam. It references Mastra-owned
// identifiers (`messageId`, `threadId`) but holds NO foreign key to the
// `mastra_*` tables: Mastra owns that DDL at runtime, drizzle-kit owns this
// table, and the two never cross with a database-level constraint. Integrity
// across the seam is enforced in the router (verify the thread is owned, verify
// the message exists via the `@acme/rag` Drizzle mirror) rather than by Postgres.

// Same per-app Postgres schema Mastra and the knowledge base namespace under
// (NEXT_PUBLIC_WEBAPP). Declaring it here is idempotent — drizzle-kit dedupes by
// name — and keeps this table co-located with the threads/messages it annotates.
export const feedbackSchema = pgSchema(env.NEXT_PUBLIC_WEBAPP);

export const feedbackRating = feedbackSchema.enum('feedback_rating', [
  'up',
  'down',
]);

export const messageFeedback = feedbackSchema.table(
  'message_feedback',
  (t) => ({
    id: t.uuid('id').primaryKey().defaultRandom(),
    // Mastra-owned identifiers, carried by value across the seam (no FK).
    messageId: t.text('message_id').notNull(),
    threadId: t.text('thread_id').notNull(),
    userId: t.text('user_id').notNull(),
    rating: feedbackRating('rating').notNull(),
    comment: t.text('comment'),
    createdAt: t
      .timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: t
      .timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  }),
  (t) => [
    // One row per (user, message): submitting again upserts the rating/comment.
    unique('message_feedback_message_user_unique').on(t.messageId, t.userId),
  ],
);

export const selectFeedbackSchema = createSelectSchema(messageFeedback, {
  id: z.uuid(),
  messageId: z.string(),
  threadId: z.string(),
  userId: z.string(),
  rating: z.enum(['up', 'down']),
  comment: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type SelectFeedbackSchema = z.infer<typeof selectFeedbackSchema>;

export const insertFeedbackSchema = createInsertSchema(messageFeedback, {
  messageId: z.string().min(1),
  threadId: z.uuid(),
  userId: z.string().min(1),
  rating: z.enum(['up', 'down']),
  comment: z.string().max(2000).nullish(),
}).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertFeedbackSchema = z.infer<typeof insertFeedbackSchema>;

// Procedure input schemas.
export const SubmitFeedbackRequest = z.object({
  messageId: z.string().min(1, 'Required'),
  threadId: z.uuid(),
  rating: z.enum(['up', 'down']),
  comment: z.string().max(2000, 'Too long').nullish(),
});
export type SubmitFeedbackRequest = z.infer<typeof SubmitFeedbackRequest>;

export const MessageFeedbackRequest = z.object({
  messageId: z.string().min(1, 'Required'),
});
