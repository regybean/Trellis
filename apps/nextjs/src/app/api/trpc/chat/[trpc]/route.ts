import { appRouter } from '@acme/chat/server';

import {
  createTRPCRouteHandlers,
  resolveContextWithEntitlements,
} from '~/server/trpc-route';

export const { GET, POST, OPTIONS } = createTRPCRouteHandlers({
  endpoint: '/api/trpc/chat',
  router: appRouter,
  resolver: resolveContextWithEntitlements,
});
