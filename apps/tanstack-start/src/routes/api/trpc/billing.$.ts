import { createFileRoute } from '@tanstack/react-router';

import { appRouter, createTRPCContext } from '@acme/billing/server';

import { createTRPCServerHandlers } from '~/lib/trpc-route';

export const Route = createFileRoute('/api/trpc/billing/$')({
  server: {
    handlers: createTRPCServerHandlers({
      endpoint: '/api/trpc/billing',
      router: appRouter,
      createContext: createTRPCContext,
    }),
  },
});
