import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { logger } from '@acme/logger';

import type { StreamChatEvent } from '../schemas/chat-schema';
import {
  ChatRequest,
  DeleteChatRequest,
  selectChatSchema,
} from '../schemas/chat-schema';
import { selectMessageSchema } from '../schemas/message-schema';
import { chatAgent } from '../services/chat-agent';
import {
  createConversation,
  deleteConversation,
  getConversationUnchecked,
  latestAssistantMessageId,
  listConversations,
  recallMessages,
  toConversation,
  toMessages,
} from '../services/chat-memory';
import {
  adminProcedure,
  createTRPCRouter,
  existingConversationProcedure,
  ownedConversationProcedure,
  rateLimit,
} from '../trpc';

export const chatRouter = createTRPCRouter({
  // Streamed query using async generator (tRPC v11 httpBatchStreamLink).
  // Ownership is enforced by `ownedConversationProcedure` before any LLM call;
  // a brand-new Conversation has no thread yet (`ctx.conversation` is null) and
  // Mastra Memory stamps `resourceId = userId` as it persists the turn.
  stream: ownedConversationProcedure
    .use(rateLimit())
    .input(ChatRequest)
    .subscription(async function* ({ ctx, input }) {
      const { userId } = ctx.auth;
      const { sessionId } = input;

      ctx.telemetry.set({
        'user.id': userId,
        'input.sessionId': sessionId,
      });

      logger.info({ userId, sessionId }, 'Starting streamed chat query');

      try {
        const result = await chatAgent.stream(input.query, {
          memory: { thread: sessionId, resource: userId },
        });

        let accumulatedResponse = '';

        for await (const chunk of result.textStream) {
          accumulatedResponse += chunk;

          const streamEvent: StreamChatEvent = {
            type: 'message',
            acc: accumulatedResponse,
            chunk,
            ts: Date.now().toString(),
            sessionId,
          };

          yield { ...streamEvent };
        }

        // Drain the stream so Mastra has finished persisting the assistant turn
        // before we read back its minted id. This await is load-bearing: the
        // `mastra_messages` row may not exist until the stream fully resolves.
        await result.text;

        const messageId = await latestAssistantMessageId(sessionId, userId);

        const doneEvent: StreamChatEvent = {
          type: 'done',
          ts: Date.now().toString(),
          sessionId,
          messageId,
        };

        yield { ...doneEvent };

        ctx.telemetry.set({
          'result.responseLength': accumulatedResponse.length,
          'result.success': true,
        });

        logger.info({ userId, sessionId }, 'Completed streamed chat query');
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

  create: ownedConversationProcedure
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

        const thread =
          ctx.conversation ??
          (await createConversation(input.sessionId, userId));

        return ctx.telemetry.parseWithTelemetry(
          selectChatSchema,
          toConversation(thread),
          'selectChatSchema',
        );
      } catch (error) {
        if (error instanceof TRPCError) throw error;
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

  get: existingConversationProcedure
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
          'Fetching chat from memory',
        );

        const dbMessages = await recallMessages(input.sessionId, userId);
        const rendered = toMessages(dbMessages, input.sessionId);

        ctx.telemetry.set({ 'result.messageCount': rendered.length });

        return rendered.map((msg) =>
          ctx.telemetry.parseWithTelemetry(
            selectMessageSchema,
            msg,
            'selectMessageSchema',
          ),
        );
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        logger.error(
          { error, userId, sessionId: input.sessionId },
          'Failed to fetch messages',
        );
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch messages from memory',
          cause: error,
        });
      }
    }),

  delete: existingConversationProcedure
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

        await deleteConversation(input.sessionId);

        ctx.telemetry.set({ 'result.deleted': true });

        return toConversation(ctx.conversation);
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        logger.error(
          { error, userId, sessionId: input.sessionId },
          'Failed to delete chat session',
        );
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to delete chat session from memory',
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

        const thread = await getConversationUnchecked(input.sessionId);
        if (!thread) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Chat session not found',
          });
        }

        ctx.telemetry.set({ 'result.found': true });

        return toConversation(thread);
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        logger.error(
          { error, adminId: ctx.auth.userId, sessionId: input.sessionId },
          'Admin failed to fetch chat',
        );
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch chat from memory',
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

        const threads = await listConversations(input.userId);

        ctx.telemetry.set({ 'result.chatCount': threads.length });

        return threads.map((thread) => toConversation(thread));
      } catch (error) {
        logger.error(
          { error, adminId: ctx.auth.userId, targetUserId: input.userId },
          'Admin failed to fetch chats for user',
        );
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch chats from memory',
          cause: error,
        });
      }
    }),
});
