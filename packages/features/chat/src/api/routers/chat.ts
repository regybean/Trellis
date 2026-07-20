import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { logger } from '@acme/logger';

import type { StreamChatEvent } from '../schemas/chat-schema';
import {
  ChatRequest,
  DeleteChatRequest,
  ReconcileTurnRequest,
  selectChatSchema,
  selectConversationSummarySchema,
  SendChatRequest,
  StopChatRequest,
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
  persistUserMessage,
  recallMessages,
  setThreadFolder,
  toConversation,
  toConversationSummary,
  toMessages,
} from '../services/chat-memory';
import { enqueueGenerationTurn } from '../services/chat-queue';
import {
  acquireInflightLock,
  cleanupTurn,
  CREDITS_PER_TURN,
  publishAbort,
  readInflightTurn,
  refundTurnCredits,
  releaseInflightLock,
} from '../services/chat-turn-lifecycle';
import {
  adminProcedure,
  createTRPCRouter,
  existingConversationProcedure,
  ownedConversationByIdProcedure,
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

  // ==========================================================================
  // DURABLE-STREAM CONTROL PLANE: send / stop / reconcileTurn
  //
  // Generation is decoupled from the client connection: `send` initiates a Turn
  // (persist + enqueue) and returns immediately; the worker produces tokens to a
  // Redis Stream; `chat.stream` (a pure reader) tails it. `stop` and
  // `reconcileTurn` are the control plane over that out-of-band Turn.
  // ==========================================================================

  // Initiate a Turn. Ownership is asserted by the builder before any mutating
  // step. The step order is load-bearing: the In-flight lock is taken FIRST so a
  // duplicate tab returns `alreadyInflight` without persisting a message,
  // enqueuing a job, or spending a credit; credits are consumed only after the
  // lock is won, so the race can never double-charge.
  send: ownedConversationByIdProcedure
    .input(SendChatRequest)
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx.auth;
      const { conversationId, turnId, query } = input;

      // 2. Acquire the In-flight lock (SET NX EX, value = turnId).
      const acquired = await acquireInflightLock(conversationId, turnId);
      if (!acquired) {
        logger.info(
          { userId, conversationId },
          'chat.send: Turn already in-flight, caller re-attaches',
        );
        return { status: 'alreadyInflight' as const };
      }

      try {
        // 3. Ensure the Conversation (idempotent create-or-retrieve).
        if (!ctx.conversation) await createConversation(conversationId, userId);

        // 4. Persist the user Message — durable in chat.get before the first
        //    token, since the worker's memory config is read-only.
        await persistUserMessage(conversationId, userId, query);

        // 5. Consume credits. The lock is already held, so a duplicate tab
        //    never reaches here; on insufficient credits we release the lock so
        //    the Conversation is not stuck for the lock's TTL.
        if (ctx.credits.remaining < CREDITS_PER_TURN) {
          await releaseInflightLock(conversationId, turnId);
          throw new TRPCError({
            code: 'TOO_MANY_REQUESTS',
            message: 'Insufficient credits',
          });
        }
        await ctx.entitlements.consume(userId, ctx.tier, CREDITS_PER_TURN);

        // 6. Enqueue the generation job (sole authorised enqueuer).
        await enqueueGenerationTurn({
          conversationId,
          turnId,
          userId,
          tier: ctx.tier,
          query,
        });

        logger.info({ userId, conversationId, turnId }, 'chat.send: accepted');
        return { status: 'accepted' as const, turnId };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        // Any failure after the lock was taken must release it, or the
        // Conversation is wedged until the lock TTL lapses.
        await releaseInflightLock(conversationId, turnId);
        logger.error(
          { error, userId, conversationId, turnId },
          'chat.send failed',
        );
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to start chat generation',
          cause: error,
        });
      }
    }),

  // Cancel the in-flight Turn. Reads the current `turnId` from the lock value and
  // publishes the abort signal; the worker observes it, persists any non-empty
  // partial, and emits the `cancelled` terminal. Returns immediately — the reader
  // surfaces the terminal to the client.
  stop: ownedConversationByIdProcedure
    .input(StopChatRequest)
    .mutation(async ({ ctx, input }) => {
      const { conversationId } = input;
      const turnId = await readInflightTurn(conversationId);
      if (!turnId) {
        return { status: 'notInflight' as const };
      }
      await publishAbort(conversationId, turnId);
      logger.info(
        { userId: ctx.auth.userId, conversationId, turnId },
        'chat.stop: abort published',
      );
      return { status: 'stopped' as const, turnId };
    }),

  // Idempotent orphan cleanup. Called by the client when the reader finds a
  // stream with no live worker (lock absent, no terminal received). Refunds the
  // Turn's credit (guarded, so the worker error path and this can't double
  // refund) and tears down the Turn's Redis state. Returns whether this call
  // performed the refund so the client can toast "generation failed, refunded".
  reconcileTurn: ownedConversationByIdProcedure
    .input(ReconcileTurnRequest)
    .mutation(async ({ ctx, input }) => {
      const { conversationId, turnId } = input;
      const refunded = await refundTurnCredits(
        ctx.auth.userId,
        ctx.tier,
        turnId,
      );
      await cleanupTurn(conversationId, turnId);
      logger.info(
        { userId: ctx.auth.userId, conversationId, turnId, refunded },
        'chat.reconcileTurn: cleaned up',
      );
      return { refunded };
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
