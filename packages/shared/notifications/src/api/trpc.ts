import { createFeatureTRPC } from '@acme/trpc';

// Notifications owns no database — it is a pure Redis-stream primitive — so it
// builds on the db-less `createFeatureTRPC()`. Every procedure receives the base
// context (auth + billing), from which the `stream` subscription reads
// `ctx.auth.userId`. This is the first `shared` package to own a tRPC router
// (ADR 0030): the platform stays router-free and React-free.
export const {
  createTRPCContext,
  createTRPCRouter,
  createCallerFactory,
  protectedProcedure,
} = createFeatureTRPC();
