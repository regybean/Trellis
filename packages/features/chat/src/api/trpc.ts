import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { createDb } from '@acme/db';
import { createFeatureTRPCWithDb } from '@acme/trpc';

import { loadOwnedConversation } from './services/chat-memory';

const _db = createDb();

export const db = _db;
export type db = typeof _db;

export const {
  createTRPCContext,
  createTRPCRouter,
  createCallerFactory,
  protectedProcedure,
  adminProcedure,
  rateLimit,
} = createFeatureTRPCWithDb(_db);

const conversationInput = z.object({ sessionId: z.uuid() });

// Loads and verifies ownership of the Conversation named by `sessionId`,
// injecting the verified thread as `ctx.conversation`. Ownership becomes
// structural: a procedure built on this cannot touch a Conversation it has not
// checked. Absent threads are tolerated (injected as `null`) — `stream` and
// `create` legitimately run before the thread is stamped. A thread owned by
// another user throws FORBIDDEN inside the adapter.
export const ownedConversationProcedure = protectedProcedure.use(
  async ({ ctx, getRawInput, next }) => {
    const { sessionId } = conversationInput.parse(await getRawInput());
    const conversation = await loadOwnedConversation(
      sessionId,
      ctx.auth.userId,
    );
    return next({ ctx: { conversation } });
  },
);

// Like `ownedConversationProcedure`, but the Conversation must already exist:
// an absent thread throws NOT_FOUND, so `ctx.conversation` is injected non-null.
export const existingConversationProcedure = protectedProcedure.use(
  async ({ ctx, getRawInput, next }) => {
    const { sessionId } = conversationInput.parse(await getRawInput());
    const conversation = await loadOwnedConversation(
      sessionId,
      ctx.auth.userId,
    );
    if (!conversation) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Chat session not found',
      });
    }
    return next({ ctx: { conversation } });
  },
);

const conversationIdInput = z.object({ conversationId: z.uuid() });

// The durable-stream sibling of `ownedConversationProcedure`: identical
// load-and-verify ownership, but keyed on `conversationId` (the vocabulary the
// `send`/`stop`/`reconcileTurn` control plane speaks) rather than `sessionId`.
// Absent threads are tolerated — `send` runs before the first Turn stamps the
// thread, and `stop`/`reconcileTurn` are safe no-ops against an absent one.
export const ownedConversationByIdProcedure = protectedProcedure.use(
  async ({ ctx, getRawInput, next }) => {
    const { conversationId } = conversationIdInput.parse(await getRawInput());
    const conversation = await loadOwnedConversation(
      conversationId,
      ctx.auth.userId,
    );
    return next({ ctx: { conversation } });
  },
);
