import { createFeatureTRPC } from '@acme/trpc';

export const {
  createTRPCContext,
  createTRPCRouter,
  createCallerFactory,
  protectedProcedure,
  adminProcedure,
} = createFeatureTRPC();
