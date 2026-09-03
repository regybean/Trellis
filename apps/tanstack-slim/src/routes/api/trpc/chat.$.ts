import { createFileRoute } from '@tanstack/react-router';

import { appRouter, createTRPCContext } from '@acme/chat/server';

import { createTRPCServerHandlersWithEntitlements } from '~/lib/trpc-route';

export const Route = createFileRoute('/api/trpc/chat/$')({
  server: {
    handlers: createTRPCServerHandlersWithEntitlements({
      endpoint: '/api/trpc/chat',
      router: appRouter,
      createContext: createTRPCContext,
    }),
  },
});
