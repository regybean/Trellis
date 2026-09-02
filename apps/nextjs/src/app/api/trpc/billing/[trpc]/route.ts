import { appRouter, createTRPCContext } from '@acme/billing/server';

import { createTRPCRouteHandlersWithEntitlements } from '~/server/trpc-route';

export const { GET, POST, OPTIONS } = createTRPCRouteHandlersWithEntitlements({
  endpoint: '/api/trpc/billing',
  router: appRouter,
  createContext: createTRPCContext,
});
