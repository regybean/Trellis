import { createDb } from '@acme/db';
import { createFeatureTRPCWithDb } from '@acme/trpc';

// Feedback owns an app-managed Drizzle table, so it builds its tRPC instance via
// `createFeatureTRPCWithDb`: the same neutral context (the session injected by
// the app adapter) every feature shares, plus an instrumented `ctx.db`. No
// context extension — feedback has no tier to gate on and no credit to spend, so
// it names no billing type at all (#256, ADR 0006). Telemetry is ambient (ADR
// 0023). The connection has no `schema` bound — the router
// queries table objects directly (its own `messageFeedback` plus the
// `@acme/rag` Drizzle mirror of `mastra_messages`).
const _db = createDb();

export const db = _db;
export type db = typeof _db;

export const {
  createTRPCContext,
  createTRPCRouter,
  createCallerFactory,
  protectedProcedure,
  adminProcedure,
} = createFeatureTRPCWithDb(_db);
