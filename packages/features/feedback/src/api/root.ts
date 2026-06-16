import { feedbackRouter } from './routers/feedback';
import { createTRPCRouter } from './trpc';

/**
 * This is the primary router for this feature.
 *
 * All routers added in ./routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
  feedback: feedbackRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;
