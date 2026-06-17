import { appRouter, createTRPCContext } from '@acme/billing/server';

import { createTRPCRouteHandlers } from '~/server/trpc-route';

export const { GET, POST, OPTIONS } = createTRPCRouteHandlers({
  endpoint: '/api/trpc/billing',
  router: appRouter,
  createContext: createTRPCContext,
});
