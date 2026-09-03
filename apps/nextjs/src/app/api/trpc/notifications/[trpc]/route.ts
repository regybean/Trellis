import { appRouter } from '@acme/notifications/server';

import { createTRPCRouteHandlers, resolveContext } from '~/server/trpc-route';

export const { GET, POST, OPTIONS } = createTRPCRouteHandlers({
  endpoint: '/api/trpc/notifications',
  router: appRouter,
  resolver: resolveContext,
});
