import { appRouter, createTRPCContext } from '@acme/notifications/server';

import { createTRPCRouteHandlers } from '~/server/trpc-route';

export const { GET, POST, OPTIONS } = createTRPCRouteHandlers({
  endpoint: '/api/trpc/notifications',
  router: appRouter,
  createContext: createTRPCContext,
});
