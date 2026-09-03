import { tracked, TRPCError } from '@trpc/server';
import { z } from 'zod';

import type { SubscriptionTier } from '@acme/entitlements';
import { logger } from '@acme/logger';
import { HEAD_CURSOR } from '@acme/redis';

import { env } from '../../env';
import {
  DeleteChatRequest,
  InflightTurnRequest,
  ReconcileTurnRequest,
  selectChatSchema,
  selectConversationSummarySchema,
  SendChatRequest,
  StopChatRequest,
  StreamReaderRequest,
} from '../schemas/chat-schema';
import { SetFolderRequest } from '../schemas/folder-schema';
import {
  selectMessageSchema,
  uiMessageSchema,
} from '../schemas/message-schema';
import {
  createConversation,
  deleteConversation,
  getConversationUnchecked,
  listConversations,
  listConversationsForUser,
  recallMessages,
  setThreadFolder,
  toConversation,
  toConversationSummary,
  toMessages,
} from '../services/chat-memory';
import { chatStream, coalesce, isTerminalEvent } from '../services/chat-stream';
import {
  abortTurn,
  beginTurn,
  readInflightTurn,
  reconcileTurn,
} from '../services/chat-turn-lifecycle';
import {
  adminProcedure,
  createTRPCRouter,
  db,
  existingConversationProcedure,
  ownedConversationByIdProcedure,
  ownedConversationProcedure,
  protectedProcedure,
} from '../trpc';
import { assertFolderOwned, foldersRouter } from './folders';

// CREDITS_PER_TURN has one origin in env (ADR 0033) — the credit gate + consume
// read it here; the Turn lifecycle's refund reads the same config value.

export const chatRouter = createTRPCRouter({
  // Pure, stateless reader of the durable token Stream — no LLM call, no
  // Message persistence, no lock operations (the Generation worker owns all of
  // those; see chat-local ADR 0002). It tails `chatStreamKey(conversationId)`
  // from `lastEventId` (or the head) and re-emits each Redis entry via tRPC v11
  // `tracked(entryId, event)`, so the entry id becomes the SSE `Last-Event-ID`
  // and a reconnecting client resumes exactly where it left off. Ownership is
  // asserted by the builder; an absent thread (no Turn ever started) drains to
  // an empty stream and closes. Closes on a terminal (done/cancelled/error).
  stream: ownedConversationByIdProcedure
    .input(StreamReaderRequest)
    .subscription(async function* ({ ctx, input, signal }) {
      const { conversationId, lastEventId } = input;
      logger.info(
        { userId: ctx.session.user.id, conversationId, lastEventId },
        'chat.stream: reader attached',
      );

      // The transport is the shared durable-stream primitive; chat supplies only
      // its own policy. `keepGoing` is the in-flight-Turn lock probe — the reader
      // no longer reaches into the Turn control plane itself; the router (which
      // owns that plane) injects it. `transform` is the delta-coalesce. A fixed
      // poll cadence (min == max) holds while a Turn streams. The loop breaks on a
      // terminal, closing the tail (its `.return()` tears the poll loop down).
      for await (const { id, event } of chatStream(conversationId).tail(
        lastEventId ?? HEAD_CURSOR,
        {
          pollMinMs: env.POLL_INTERVAL_MS,
          pollMaxMs: env.POLL_INTERVAL_MS,
          signal,
          keepGoing: async () =>
            (await readInflightTurn(conversationId)) !== null,
          transform: coalesce,
        },
      )) {
        yield tracked(id, event);
        if (isTerminalEvent(event)) break;
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
  // step; the begin-step ordering and the failure-path lock unwind live in the
  // Turn lifecycle's `beginTurn` (the lock is taken FIRST, so a duplicate tab
  // returns `alreadyInflight` without persisting a Message, enqueuing a job, or
  // spending a credit). The credit gate + consume stays inline here (ADR 0006
  // amendment + chat CONTEXT): a rejected send consumes nothing, and `beginTurn`
  // runs this closure after the lock is won and the user Message is persisted,
  // before enqueue — so the race can never double-charge.
  send: ownedConversationByIdProcedure
    .input(SendChatRequest)
    .mutation(async ({ ctx, input }) => {
      const { id: userId } = ctx.session.user;
      const { conversationId, turnId, query } = input;

      // `send` is the one chat procedure that spends credits, so it is the one
      // that resolves entitlements — once, here, rather than on every tRPC call
      // in the app (#250). Every read below is off this snapshot.
      const { tier, credits } = await ctx.entitlements.resolve(userId);

      try {
        const outcome = await beginTurn({
          conversationId,
          turnId,
          userId,
          tier,
          query,
          conversationExists: ctx.conversation != null,
          consume: async () => {
            if (credits.remaining < env.CREDITS_PER_TURN) {
              throw new TRPCError({
                code: 'TOO_MANY_REQUESTS',
                message: 'Insufficient credits',
              });
            }
            await ctx.entitlements.consume(userId, tier, env.CREDITS_PER_TURN);
          },
        });

        if (outcome.status === 'alreadyInflight') {
          logger.info(
            { userId, conversationId },
            'chat.send: Turn already in-flight, caller re-attaches',
          );
          return { status: 'alreadyInflight' as const };
        }

        logger.info({ userId, conversationId, turnId }, 'chat.send: accepted');
        return { status: 'accepted' as const, turnId };
      } catch (error) {
        // `beginTurn` has already released the lock on any failure branch; here
        // we only map the error. A credit-exhaustion `TOO_MANY_REQUESTS` (or any
        // other TRPCError) surfaces as-is; anything else is a start failure.
        if (error instanceof TRPCError) throw error;
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
      await abortTurn({ conversationId, turnId });
      logger.info(
        { userId: ctx.session.user.id, conversationId, turnId },
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
      const userId = ctx.session.user.id;
      // The credit goes back at the caller's current tier — resolved here
      // because this procedure is one of the two that touch the ledger, not
      // because every request needs it (#250).
      const { tier } = await ctx.entitlements.resolve(userId);
      const { refunded } = await reconcileTurn(
        (uid: string, creditTier: SubscriptionTier, amount: number) =>
          ctx.entitlements.refund(uid, creditTier, amount),
        userId,
        tier,
        { conversationId, turnId },
      );
      logger.info(
        { userId, conversationId, turnId, refunded },
        'chat.reconcileTurn: cleaned up',
      );
      return { refunded };
    }),

  // Mount-time resume probe. Returns the `turnId` currently in flight for the
  // Conversation (the In-flight lock value), or null when idle. A client that
  // reloads mid-generation reads this to decide whether to reopen the pure
  // reader and resume; the returned `turnId` is what it arms for reconcile if
  // the Turn turns out to be orphaned. Pure read (no side effects), gated by the
  // durable-stream ownership builder like the rest of the control plane.
  inflightTurn: ownedConversationByIdProcedure
    .input(InflightTurnRequest)
    .query(async ({ input }) => {
      const turnId = await readInflightTurn(input.conversationId);
      return { turnId };
    }),

  create: ownedConversationProcedure
    .input(z.object({ sessionId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { id: userId } = ctx.session.user;

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

  // Output is the UI Message shape (`uiMessageSchema`), not the bare persisted
  // row: the client streams the optimistic user Message and the assistant's
  // deltas into THIS query's cache (single source of truth — see use-chat), so
  // an entry may transiently carry `loading`/`error` and lack an `id`. The
  // server only ever returns settled rows (those optional fields absent), but
  // typing the query as `Message[]` is what lets `setQueryData` write in-flight
  // entries without a cast.
  get: ownedConversationProcedure
    .input(z.object({ sessionId: z.uuid() }))
    .output(z.array(uiMessageSchema))
    .query(async ({ ctx, input }) => {
      const { id: userId } = ctx.session.user;

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
      const { id: userId } = ctx.session.user;

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
    const { id: userId } = ctx.session.user;

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
      const { id: userId } = ctx.session.user;

      // The target Folder, when given, must belong to the caller. Ownership is
      // asserted through the folders module so `chat_folder` is only ever
      // queried there — no naked Drizzle query in this router body.
      if (input.folderId) {
        await assertFolderOwned(db, input.folderId, userId);
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
          { adminId: ctx.session.user.id, sessionId: input.sessionId },
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
          { error, adminId: ctx.session.user.id, sessionId: input.sessionId },
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
          { adminId: ctx.session.user.id, targetUserId: input.userId },
          'Admin fetching chats for user',
        );

        const threads = await listConversations(input.userId);

        return threads.map((thread) => toConversation(thread));
      } catch (error) {
        logger.error(
          { error, adminId: ctx.session.user.id, targetUserId: input.userId },
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
