import { initTRPC } from '@trpc/server';

import type { BaseContext } from '@acme/trpc';
import { createDb } from '@acme/db';
import { instrumentDrizzleClient } from '@acme/telemetry';
import {
  requirePrincipal,
  trpcConfig,
  withProcedureSpan,
  withTimingLog,
} from '@acme/trpc';

/**
 * Feedback's tRPC instance, built on its own concrete context: the neutral
 * `BaseContext` the app adapter injects, and nothing else. Feedback has no tier
 * to gate on and no credit to spend, so it names no billing type at all (#256,
 * ADR 0006). Telemetry is ambient (ADR 0023).
 */
export type FeedbackContext = BaseContext;

/**
 * Feedback's Drizzle client, instrumented for tracing once at module load, and
 * imported directly by the routers rather than read off `ctx.db` (#264). The
 * connection has no `schema` bound — the router queries table objects directly
 * (its own `messageFeedback` plus the `@acme/rag` Drizzle mirror of
 * `mastra_messages`).
 */
export const db = createDb();

instrumentDrizzleClient(db, { dbSystem: 'postgresql' });

const t = initTRPC.context<FeedbackContext>().create(trpcConfig);

// The shared middleware stack, composed against feedback's own concrete
// context. The bodies live once in `@acme/trpc` as plain async helpers; only
// this wiring is per-feature (#264). No admin gate — every feedback procedure
// acts on the caller's own rating, so there is nothing here an admin reads that
// a user doesn't. Add one the way chat and ingest do (`requireAdmin`, three
// lines) if a moderation procedure ever earns it.
const telemetry = t.middleware(({ next, path, type, ctx }) =>
  withProcedureSpan({ path, type, userId: ctx.session.user?.id }, next),
);
const timing = t.middleware(({ next, path }) => withTimingLog(path, next));
const authed = t.middleware(({ next, ctx }) =>
  next({ ctx: { session: { user: requirePrincipal(ctx.session) } } }),
);

export const createTRPCRouter = t.router;
export const createCallerFactory = t.createCallerFactory;
const publicProcedure = t.procedure.use(telemetry).use(timing);
export const protectedProcedure = publicProcedure.use(authed);
