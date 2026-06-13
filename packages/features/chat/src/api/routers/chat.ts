import { TRPCError } from '@trpc/server';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { logger } from '@acme/logger';

import type { StreamChatEvent } from '../schemas/chat-schema';
import type { db } from '../trpc';
import {
  ChatRequest,
  chats,
  DeleteChatRequest,
  selectChatSchema,
} from '../schemas/chat-schema';
import { messages, selectMessageSchema } from '../schemas/message-schema';
import { chatService } from '../services/chat-service';
import {
  adminProcedure,
  createTRPCRouter,
  protectedProcedure,
  rateLimit,
} from '../trpc';

// A drizzle client or an open transaction — the helpers below run under either,
// so the stream procedure can wrap Conversation creation + the user Message in
// one transaction.
type DbOrTx = db | Parameters<Parameters<db['transaction']>[0]>[0];

// Create-or-retrieve the Conversation row, enforcing ownership. Idempotent and
// race-safe (onConflictDoNothing then re-read). Shared by `create` and `stream`.
async function ensureChat(client: DbOrTx, userId: string, sessionId: string) {
  await client
    .insert(chats)
    .values({ sessionId, userId })
    .onConflictDoNothing();

  const [chat] = await client
    .select()
    .from(chats)
    .where(eq(chats.sessionId, sessionId))
    .limit(1);

  if (!chat) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to create or retrieve chat session',
    });
  }
  if (chat.userId !== userId) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You do not have access to this chat session',
    });
  }
  return chat;
}

async function persistMessage(
  client: DbOrTx,
  sessionId: string,
  role: 'user' | 'assistant',
  text: string,
) {
  await client.insert(messages).values({ sessionId, role, text });
}

export const chatRouter = createTRPCRouter({
  // Streamed query using async generator (tRPC v11 httpBatchStreamLink)
  stream: protectedProcedure
    .input(ChatRequest)
    .use(rateLimit())
    .subscription(async function* ({ ctx, input }) {
      const { userId } = ctx.auth;
      const { sessionId } = input;

      ctx.telemetry.set({
        'user.id': userId,
        'input.sessionId': sessionId,
      });

      logger.info({ userId, sessionId }, 'Starting streamed chat query');

      try {
        // Prior turns in this Conversation, fetched before the new user Message
        // is recorded (the current query is passed to the model separately).
        const messageHistory = await ctx.db
          .select()
          .from(messages)
          .where(eq(messages.sessionId, sessionId))
          .orderBy(asc(messages.timestamp));

        ctx.telemetry.set({ 'messageHistory.count': messageHistory.length });

        // Ensure the Conversation exists and record the user Message before any
        // LLM call — one transaction, so a new Conversation never lands without
        // its first user turn.
        await ctx.db.transaction(async (tx) => {
          await ensureChat(tx, userId, sessionId);
          await persistMessage(tx, sessionId, 'user', input.query);
        });

        const stream = chatService.query(
          input.query,
          messageHistory,
          sessionId,
        );
        let accumulatedResponse = '';

        for await (const chunk of stream) {
          accumulatedResponse += chunk.delta;

          const streamEvent: StreamChatEvent = {
            type: 'message',
            acc: accumulatedResponse,
            chunk: chunk.delta,
            ts: Date.now().toString(),
            sessionId,
          };

          yield { ...streamEvent };
        }

        ctx.telemetry.set({
          'result.responseLength': accumulatedResponse.length,
          'result.success': true,
        });

        logger.info({ userId, sessionId }, 'Completed streamed chat query');

        // Persist the completed assistant Message only on clean completion — a
        // mid-stream failure leaves the user turn recorded and retryable.
        if (accumulatedResponse) {
          await persistMessage(
            ctx.db,
            sessionId,
            'assistant',
            accumulatedResponse,
          );
        }
      } catch (error) {
        ctx.telemetry.set({ 'result.success': false });
        logger.error(
          { error, userId, sessionId },
          'Streamed chat query failed',
        );
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to stream chat response',
          cause: error,
        });
      }
    }),

  create: protectedProcedure
    .input(z.object({ sessionId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx.auth;

      ctx.telemetry.set({
        'user.id': userId,
        'input.sessionId': input.sessionId,
      });

      try {
        logger.info(
          { userId, sessionId: input.sessionId },
          'Creating chat session',
        );

        const chat = await ensureChat(ctx.db, userId, input.sessionId);

        return ctx.telemetry.parseWithTelemetry(
          selectChatSchema,
          chat,
          'selectChatSchema',
        );
      } catch (error) {
        logger.error(
          { error, userId, sessionId: input.sessionId },
          'Failed to create chat session',
        );
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create chat session',
          cause: error,
        });
      }
    }),

  get: protectedProcedure
    .input(z.object({ sessionId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const { userId } = ctx.auth;

      ctx.telemetry.set({
        'user.id': userId,
        'input.sessionId': input.sessionId,
      });

      try {
        logger.info(
          { userId, sessionId: input.sessionId },
          'Fetching chat from database',
        );

        // Validation
        const chatRecord = await ctx.db
          .select()
          .from(chats)
          .where(eq(chats.sessionId, input.sessionId))
          .limit(1);

        if (chatRecord.length === 0) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Chat session not found',
          });
        }

        if (chatRecord[0]?.userId !== userId) {
          ctx.telemetry.set({ 'auth.forbidden': true });
          logger.warn(
            { userId, sessionId: input.sessionId },
            'User attempted to fetch messages from chat they do not own',
          );
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'You do not have access to this chat session',
          });
        }

        const messageArray = await ctx.db
          .select()
          .from(messages)
          .where(eq(messages.sessionId, input.sessionId))
          .orderBy(asc(messages.timestamp));

        ctx.telemetry.set({ 'result.messageCount': messageArray.length });

        return messageArray.map((msg) =>
          ctx.telemetry.parseWithTelemetry(
            selectMessageSchema,
            msg,
            'selectMessageSchema',
          ),
        );
      } catch (error) {
        logger.error(
          { error, userId, sessionId: input.sessionId },
          'Failed to fetch messages',
        );
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch messages from database',
          cause: error,
        });
      }
    }),

  delete: protectedProcedure
    .input(DeleteChatRequest)
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx.auth;

      ctx.telemetry.set({
        'user.id': userId,
        'input.sessionId': input.sessionId,
      });

      try {
        logger.info(
          { userId, sessionId: input.sessionId },
          'Deleting chat session',
        );

        // Validation
        const chatRecord = await ctx.db
          .select()
          .from(chats)
          .where(eq(chats.sessionId, input.sessionId))
          .limit(1);

        if (chatRecord.length === 0) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Chat session not found',
          });
        }

        if (chatRecord[0]?.userId !== userId) {
          ctx.telemetry.set({ 'auth.forbidden': true });
          logger.warn(
            { userId, sessionId: input.sessionId },
            'User attempted to delete chat they do not own',
          );
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'You do not have access to this chat session',
          });
        }

        const deletedChat = await ctx.db
          .delete(chats)
          .where(eq(chats.sessionId, input.sessionId))
          .returning();

        if (deletedChat.length === 0) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to delete chat session',
          });
        }

        ctx.telemetry.set({ 'result.deleted': true });

        return deletedChat[0];
      } catch (error) {
        logger.error(
          { error, userId, sessionId: input.sessionId },
          'Failed to delete chat session',
        );
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to delete chat session from database',
          cause: error,
        });
      }
    }),

  adminGet: adminProcedure
    .input(z.object({ sessionId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      ctx.telemetry.set({
        'admin.userId': ctx.auth.userId ?? '',
        'input.sessionId': input.sessionId,
      });

      try {
        logger.info(
          { adminId: ctx.auth.userId, sessionId: input.sessionId },
          'Admin fetching chat',
        );

        const chatRecord = await ctx.db
          .select()
          .from(chats)
          .where(eq(chats.sessionId, input.sessionId));

        if (chatRecord.length === 0) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Chat session not found',
          });
        }

        ctx.telemetry.set({ 'result.found': true });

        return chatRecord[0];
      } catch (error) {
        logger.error(
          { error, adminId: ctx.auth.userId, sessionId: input.sessionId },
          'Admin failed to fetch chat',
        );
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch chat from database',
          cause: error,
        });
      }
    }),

  adminList: adminProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      ctx.telemetry.set({
        'admin.userId': ctx.auth.userId ?? '',
        'target.userId': input.userId,
      });

      try {
        logger.info(
          { adminId: ctx.auth.userId, targetUserId: input.userId },
          'Admin fetching chats for user',
        );

        const chatArray = await ctx.db
          .select()
          .from(chats)
          .where(eq(chats.userId, input.userId))
          .orderBy(asc(chats.createdAt));

        ctx.telemetry.set({ 'result.chatCount': chatArray.length });

        return chatArray;
      } catch (error) {
        logger.error(
          { error, adminId: ctx.auth.userId, targetUserId: input.userId },
          'Admin failed to fetch chats for user',
        );
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch chats from database',
          cause: error,
        });
      }
    }),
});
