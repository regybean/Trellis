import { appRouter, createTRPCContext } from '@acme/chat/server';

import { createTRPCRouteHandlers } from '~/server/trpc-route';

export const { GET, POST, OPTIONS } = createTRPCRouteHandlers({
  endpoint: '/api/trpc/chat',
  router: appRouter,
  createContext: createTRPCContext,
});
