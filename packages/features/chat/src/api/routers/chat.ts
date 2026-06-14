import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { logger } from '@acme/logger';
import { memory } from '@acme/rag';

import type { StreamChatEvent } from '../schemas/chat-schema';
import type { Message } from '../schemas/message-schema';
import {
  ChatRequest,
  DeleteChatRequest,
  selectChatSchema,
} from '../schemas/chat-schema';
import { selectMessageSchema } from '../schemas/message-schema';
import { chatService } from '../services/chat-service';
import {
  adminProcedure,
  createTRPCRouter,
  protectedProcedure,
  rateLimit,
} from '../trpc';

// A Conversation is a Mastra Memory thread (id = sessionId, resourceId =
// userId). Mastra owns message persistence; these helpers translate threads and
// stored messages back into the client-facing contract.
type DBMessage = Awaited<ReturnType<typeof memory.recall>>['messages'][number];

function threadToChat(thread: {
  id: string;
  resourceId: string;
  createdAt: Date;
}) {
  return {
    sessionId: thread.id,
    userId: thread.resourceId,
    createdAt: thread.createdAt,
  };
}

function partsToText(content: DBMessage['content']) {
  if (typeof content === 'string') return content;
  let text = '';
  for (const part of content.parts) {
    if (part.type === 'text') text += part.text;
  }
  if (!text && typeof content.content === 'string') text = content.content;
  return text;
}

function renderMessages(dbMessages: DBMessage[], sessionId: string): Message[] {
  return dbMessages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      id: m.id,
      sessionId,
      role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      text: partsToText(m.content),
      timestamp: m.createdAt,
    }));
}

// Load a thread and enforce ownership. Returns null when the thread does not
// exist yet (the stream procedure creates it implicitly on the first message).
async function getOwnedThread(sessionId: string, userId: string) {
  const thread = await memory.getThreadById({ threadId: sessionId });
  if (!thread) return null;
  if (thread.resourceId !== userId) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You do not have access to this chat session',
    });
  }
  return thread;
}

export const chatRouter = createTRPCRouter({
  // Streamed query using async generator (tRPC v11 httpBatchStreamLink).
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
        // Enforce ownership before any LLM call. A brand-new Conversation has no
        // thread yet — Mastra Memory creates it (resourceId = userId) as it
        // persists the user and assistant messages around the stream.
        await getOwnedThread(sessionId, userId);

        const stream = chatService.query(input.query, sessionId, userId);
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

        const existing = await getOwnedThread(input.sessionId, userId);
        const thread =
          existing ??
          (await memory.createThread({
            threadId: input.sessionId,
            resourceId: userId,
            title: 'New conversation',
          }));

        return ctx.telemetry.parseWithTelemetry(
          selectChatSchema,
          threadToChat(thread),
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
          'Fetching chat from memory',
        );

        const thread = await getOwnedThread(input.sessionId, userId);
        if (!thread) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Chat session not found',
          });
        }

        const { messages: dbMessages } = await memory.recall({
          threadId: input.sessionId,
          resourceId: userId,
          perPage: false,
        });

        const rendered = renderMessages(dbMessages, input.sessionId);

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

        const thread = await getOwnedThread(input.sessionId, userId);
        if (!thread) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Chat session not found',
          });
        }

        await memory.deleteThread(input.sessionId);

        ctx.telemetry.set({ 'result.deleted': true });

        return threadToChat(thread);
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

        const thread = await memory.getThreadById({
          threadId: input.sessionId,
        });
        if (!thread) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Chat session not found',
          });
        }

        ctx.telemetry.set({ 'result.found': true });

        return threadToChat(thread);
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

        const { threads } = await memory.listThreads({
          filter: { resourceId: input.userId },
          perPage: false,
        });

        ctx.telemetry.set({ 'result.chatCount': threads.length });

        return threads.map((thread) => threadToChat(thread));
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
