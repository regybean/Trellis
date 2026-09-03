import { appRouter } from '@acme/ingest/server';

import { createTRPCRouteHandlers, resolveContext } from '~/server/trpc-route';

export const { GET, POST, OPTIONS } = createTRPCRouteHandlers({
  endpoint: '/api/trpc/ingest',
  router: appRouter,
  resolver: resolveContext,
});
