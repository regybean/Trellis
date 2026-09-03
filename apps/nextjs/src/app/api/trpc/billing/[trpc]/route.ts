import { appRouter } from '@acme/billing/server';

import {
  createTRPCRouteHandlers,
  resolveContextWithEntitlements,
} from '~/server/trpc-route';

export const { GET, POST, OPTIONS } = createTRPCRouteHandlers({
  endpoint: '/api/trpc/billing',
  router: appRouter,
  resolver: resolveContextWithEntitlements,
});
