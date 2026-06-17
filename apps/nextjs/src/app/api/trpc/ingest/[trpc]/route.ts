import { appRouter, createTRPCContext } from '@acme/ingest/server';

import { createTRPCRouteHandlers } from '~/server/trpc-route';

export const { GET, POST, OPTIONS } = createTRPCRouteHandlers({
  endpoint: '/api/trpc/ingest',
  router: appRouter,
  createContext: createTRPCContext,
});
