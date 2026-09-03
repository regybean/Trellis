import { initTRPC, TRPCError } from '@trpc/server';
import { z } from 'zod';

import type { EntitlementsProvider } from '@acme/entitlements';
import type { BaseContext } from '@acme/trpc';
import { createDb } from '@acme/db';
import { assertOwnedThreadForTRPC } from '@acme/rag/ownership-trpc';
import { instrumentDrizzleClient } from '@acme/telemetry';
import {
  requireAdmin,
  requirePrincipal,
  trpcConfig,
  withProcedureSpan,
  withTimingLog,
} from '@acme/trpc';

/**
 * Chat's Drizzle client, instrumented for tracing once at module load. Routers
 * import it directly rather than reading it off `ctx.db`: it is a module
 * singleton, no test ever swaps it, and threading it through a middleware only
 * bought a second name for the same object (#264).
 */
export const db = createDb();

instrumentDrizzleClient(db, { dbSystem: 'postgresql' });

/**
 * Chat's request context — the neutral base the app adapter injects, plus the
 * `EntitlementsProvider`. Chat meters credits inline in `send` and refunds
 * through the same seam in `reconcileTurn` (ADR 0006, #109 amendment), so it
 * names the provider it resolves against. The substrate names it for nobody
 * (#256), and no longer carries it as a type parameter either (#264).
 */
export interface ChatContext extends BaseContext {
  entitlements: EntitlementsProvider;
}

const t = initTRPC.context<ChatContext>().create(trpcConfig);

// The shared middleware stack, composed against chat's own concrete context.
// The bodies live once in `@acme/trpc` as plain async helpers; only this wiring
// is per-feature (#264).
const telemetry = t.middleware(({ next, path, type, ctx }) =>
  withProcedureSpan({ path, type, userId: ctx.session.user?.id }, next),
);
const timing = t.middleware(({ next, path }) =>
  withTimingLog(path, t._config.isDev, next),
);
const authed = t.middleware(({ next, ctx }) =>
  next({ ctx: { session: { user: requirePrincipal(ctx.session) } } }),
);
const admin = t.middleware(({ next, ctx }) =>
  next({ ctx: { session: { user: requireAdmin(ctx.session) } } }),
);

export const createTRPCRouter = t.router;
export const createCallerFactory = t.createCallerFactory;
export const publicProcedure = t.procedure.use(telemetry).use(timing);
export const protectedProcedure = publicProcedure.use(authed);
export const adminProcedure = publicProcedure.use(admin);

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
    const conversation = await assertOwnedThreadForTRPC(
      sessionId,
      ctx.session.user.id,
    );
    return next({ ctx: { conversation } });
  },
);

// Like `ownedConversationProcedure`, but the Conversation must already exist:
// an absent thread throws NOT_FOUND, so `ctx.conversation` is injected non-null.
export const existingConversationProcedure = protectedProcedure.use(
  async ({ ctx, getRawInput, next }) => {
    const { sessionId } = conversationInput.parse(await getRawInput());
    const conversation = await assertOwnedThreadForTRPC(
      sessionId,
      ctx.session.user.id,
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
    const conversation = await assertOwnedThreadForTRPC(
      conversationId,
      ctx.session.user.id,
    );
    return next({ ctx: { conversation } });
  },
);
