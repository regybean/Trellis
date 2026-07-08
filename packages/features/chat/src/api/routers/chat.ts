import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { logger } from '@acme/logger';

import type { StreamChatEvent } from '../schemas/chat-schema';
import {
  ChatRequest,
  DeleteChatRequest,
  selectChatSchema,
  selectConversationSummarySchema,
} from '../schemas/chat-schema';
import { SetFolderRequest } from '../schemas/folder-schema';
import { selectMessageSchema } from '../schemas/message-schema';
import { chatAgent } from '../services/chat-agent';
import {
  createConversation,
  deleteConversation,
  getConversationUnchecked,
  latestAssistantMessageId,
  listConversations,
  listConversationsForUser,
  recallMessages,
  setThreadFolder,
  toConversation,
  toConversationSummary,
  toMessages,
} from '../services/chat-memory';
import {
  adminProcedure,
  createTRPCRouter,
  existingConversationProcedure,
  ownedConversationProcedure,
  protectedProcedure,
  rateLimit,
} from '../trpc';
import { assertFolderOwned, foldersRouter } from './folders';

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

        logger.info({ userId, sessionId }, 'Completed streamed chat query');
      } catch (error) {
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

      try {
        logger.info(
          { userId, sessionId: input.sessionId },
          'Creating chat session',
        );

        const thread =
          ctx.conversation ??
          (await createConversation(input.sessionId, userId));

        return selectChatSchema.parse(toConversation(thread));
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

  get: ownedConversationProcedure
    .input(z.object({ sessionId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const { userId } = ctx.auth;

      // New session: thread doesn't exist yet, no messages to return.
      if (!ctx.conversation) return [];

      try {
        logger.info(
          { userId, sessionId: input.sessionId },
          'Fetching chat from memory',
        );

        const dbMessages = await recallMessages(input.sessionId, userId);
        const rendered = toMessages(dbMessages, input.sessionId);

        return rendered.map((msg) => selectMessageSchema.parse(msg));
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

      try {
        logger.info(
          { userId, sessionId: input.sessionId },
          'Deleting chat session',
        );

        await deleteConversation(input.sessionId);

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

  // The caller's Conversations for the history sidebar — a flat list ordered
  // `updatedAt DESC`. The client groups it into Folders and Date Buckets.
  list: protectedProcedure.query(async ({ ctx }) => {
    const { userId } = ctx.auth;

    try {
      const threads = await listConversationsForUser(userId);

      return threads.map((thread) =>
        selectConversationSummarySchema.parse(toConversationSummary(thread)),
      );
    } catch (error) {
      logger.error({ error, userId }, 'Failed to list conversations');
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to list conversations',
        cause: error,
      });
    }
  }),

  // Move a Conversation into a Folder, or out of one with `folderId: null`. The
  // assignment is a single scalar on the thread metadata (exclusivity by
  // construction). Ownership of the Conversation is enforced by the builder; the
  // Folder, when given, must also belong to the caller.
  setFolder: existingConversationProcedure
    .input(SetFolderRequest)
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx.auth;

      // The target Folder, when given, must belong to the caller. Ownership is
      // asserted through the folders module so `chat_folder` is only ever
      // queried there — no naked Drizzle query in this router body.
      if (input.folderId) {
        await assertFolderOwned(ctx.db, input.folderId, userId);
      }

      try {
        await setThreadFolder(ctx.conversation, input.folderId);
        return { sessionId: input.sessionId, folderId: input.folderId };
      } catch (error) {
        logger.error(
          { error, userId, sessionId: input.sessionId },
          'Failed to set conversation folder',
        );
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to set conversation folder',
          cause: error,
        });
      }
    }),

  // Folder CRUD (definitions only — the assignment is `setFolder` above).
  folders: foldersRouter,

  adminGet: adminProcedure
    .input(z.object({ sessionId: z.uuid() }))
    .query(async ({ ctx, input }) => {
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
      try {
        logger.info(
          { adminId: ctx.auth.userId, targetUserId: input.userId },
          'Admin fetching chats for user',
        );

        const threads = await listConversations(input.userId);

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
