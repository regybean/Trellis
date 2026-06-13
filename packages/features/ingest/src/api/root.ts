import { documentsRouter } from './routers/documents';
import { createCallerFactory, createTRPCRouter } from './trpc';

/**
 * This is the primary router for the ingest feature.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
  documents: documentsRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;

/** Create a server-side caller for the tRPC API. */
export const createCaller = createCallerFactory(appRouter);
