import { drizzle } from 'drizzle-orm/postgres-js';

import { createFeatureTRPCWithDb } from '@acme/trpc';

import { env } from '../env';

// Feedback owns an app-managed Drizzle table, so it builds its tRPC instance via
// `createFeatureTRPCWithDb`: the same neutral context (Clerk auth injected by
// the app adapter, billing, telemetry) every feature shares, plus an
// instrumented `ctx.db`. The connection has no `schema` bound — the router
// queries table objects directly (its own `messageFeedback` plus the
// `@acme/rag` Drizzle mirror of `mastra_messages`).
const _db = drizzle({
  connection: {
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
  },
});

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
