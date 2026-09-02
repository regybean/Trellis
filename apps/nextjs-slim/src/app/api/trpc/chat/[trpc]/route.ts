import { appRouter, createTRPCContext } from '@acme/chat/server';

import { createTRPCRouteHandlersWithEntitlements } from '~/server/trpc-route';

export const { GET, POST, OPTIONS } = createTRPCRouteHandlersWithEntitlements({
  endpoint: '/api/trpc/chat',
  router: appRouter,
  createContext: createTRPCContext,
});
