import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';

import { logger } from '@acme/logger';
import { assertOwnedThreadForTRPC } from '@acme/rag/ownership-trpc';
import { mastraMessages } from '@acme/rag/schema';

import {
  insertFeedbackSchema,
  messageFeedback,
  MessageFeedbackRequest,
  selectFeedbackSchema,
  SubmitFeedbackRequest,
} from '../schemas/feedback-schema';
import { createTRPCRouter, protectedProcedure } from '../trpc';

/**
 * Message feedback router. The `submit` mutation is the worked example of the
 * ADR-0002 ownership seam: a Drizzle-owned, app-managed row (`message_feedback`)
 * that annotates Mastra-owned identifiers, with integrity enforced in code
 * rather than by a database foreign key.
 *
 *   1. The thread must be owned by the caller — checked (and its FORBIDDEN
 *      mapping applied) through `assertOwnedThreadForTRPC` in `@acme/rag`, the
 *      single tRPC adapter for the ownership rule shared with the chat feature.
 *   2. The message must exist in that thread — read from Mastra-owned data via
 *      the `@acme/rag` Drizzle mirror of `mastra_messages`.
 *   3. The feedback is upserted, one row per (user, message).
 */
export const feedbackRouter = createTRPCRouter({
  // The caller's feedback for a message (zero | one). Filtered by userId so a
  // caller only ever reads their own feedback.
  forMessage: protectedProcedure
    .input(MessageFeedbackRequest)
    .query(async ({ ctx, input }) => {
      const { userId } = ctx.auth;

      const [row] = await ctx.db
        .select()
        .from(messageFeedback)
        .where(
          and(
            eq(messageFeedback.messageId, input.messageId),
            eq(messageFeedback.userId, userId),
          ),
        )
        .limit(1);

      if (!row) return null;
      return selectFeedbackSchema.parse(row);
    }),

  // Submit (or update) feedback for a message in an owned conversation.
  submit: protectedProcedure
    .input(SubmitFeedbackRequest)
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx.auth;

      // 1. Thread ownership — the Mastra-owned ownership fact. Foreign ownership
      // is mapped to FORBIDDEN inside the shared adapter; absence is a NOT_FOUND
      // here (feedback requires an existing conversation).
      const thread = await assertOwnedThreadForTRPC(input.threadId, userId);
      if (!thread) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Conversation not found',
        });
      }

      // 2. Message existence — read Mastra-owned rows through the Drizzle mirror.
      const [message] = await ctx.db
        .select({ id: mastraMessages.id })
        .from(mastraMessages)
        .where(
          and(
            eq(mastraMessages.id, input.messageId),
            eq(mastraMessages.threadId, input.threadId),
          ),
        )
        .limit(1);

      if (!message) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Message not found in this conversation',
        });
      }

      // 3. Upsert — one row per (user, message).
      const values = insertFeedbackSchema.parse({
        messageId: input.messageId,
        threadId: input.threadId,
        userId,
        rating: input.rating,
        comment: input.comment ?? null,
      });

      const [saved] = await ctx.db
        .insert(messageFeedback)
        .values(values)
        .onConflictDoUpdate({
          target: [messageFeedback.messageId, messageFeedback.userId],
          set: {
            rating: input.rating,
            comment: input.comment ?? null,
            updatedAt: new Date(),
          },
        })
        .returning();

      if (!saved) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to save feedback',
        });
      }

      logger.info(
        { userId, messageId: input.messageId, rating: input.rating },
        'feedback saved',
      );
      return selectFeedbackSchema.parse(saved);
    }),

  // Clear the caller's feedback for a message (toggle off).
  remove: protectedProcedure
    .input(MessageFeedbackRequest)
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx.auth;

      await ctx.db
        .delete(messageFeedback)
        .where(
          and(
            eq(messageFeedback.messageId, input.messageId),
            eq(messageFeedback.userId, userId),
          ),
        );

      return { messageId: input.messageId };
    }),
});
