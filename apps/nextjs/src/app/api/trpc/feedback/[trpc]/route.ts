import { appRouter, createTRPCContext } from '@acme/feedback/server';

import { createTRPCRouteHandlers } from '~/server/trpc-route';

export const { GET, POST, OPTIONS } = createTRPCRouteHandlers({
  endpoint: '/api/trpc/feedback',
  router: appRouter,
  createContext: createTRPCContext,
});
