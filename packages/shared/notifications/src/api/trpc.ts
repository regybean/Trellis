import { createFeatureTRPC } from '@acme/trpc';

// Notifications owns no database — it is a pure Redis-stream primitive — so it
// builds on the db-less `createFeatureTRPC()`. Every procedure receives the base
// context — the app-injected session, from which the `stream` subscription reads
// `ctx.session.user.id` — and no context extension: notifications has no tier to
// gate on and no credit to spend, so it names no billing type (#256, ADR 0006).
// This is the first `shared` package to own a tRPC router
// (ADR 0030): the platform stays router-free and React-free.
export const {
  createTRPCContext,
  createTRPCRouter,
  createCallerFactory,
  protectedProcedure,
} = createFeatureTRPC();
