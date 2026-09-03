import { notificationsRouter } from './routers/notifications';
import { createTRPCRouter } from './trpc';

/**
 * The concrete app router notifications owns and mounts at its own
 * `/api/trpc/notifications` endpoint in all 4 apps (there is no aggregated root
 * router in this repo — each feature/seam mounts its own; ADR 0001).
 */
export const appRouter = createTRPCRouter({
  notifications: notificationsRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;
