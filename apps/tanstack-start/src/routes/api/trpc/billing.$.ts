import { createFileRoute } from '@tanstack/react-router';

import { appRouter, createTRPCContext } from '@acme/billing/server';

import { createTRPCServerHandlersWithEntitlements } from '~/lib/trpc-route';

export const Route = createFileRoute('/api/trpc/billing/$')({
  server: {
    handlers: createTRPCServerHandlersWithEntitlements({
      endpoint: '/api/trpc/billing',
      router: appRouter,
      createContext: createTRPCContext,
    }),
  },
});
