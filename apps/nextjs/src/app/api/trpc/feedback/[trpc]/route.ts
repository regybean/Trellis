import { appRouter } from '@acme/feedback/server';

import { createTRPCRouteHandlers, resolveContext } from '~/server/trpc-route';

export const { GET, POST, OPTIONS } = createTRPCRouteHandlers({
  endpoint: '/api/trpc/feedback',
  router: appRouter,
  resolver: resolveContext,
});
