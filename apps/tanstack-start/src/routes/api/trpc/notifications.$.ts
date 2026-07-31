import { createFileRoute } from '@tanstack/react-router';

import { appRouter, createTRPCContext } from '@acme/notifications/server';

import { createTRPCServerHandlers } from '~/lib/trpc-route';

export const Route = createFileRoute('/api/trpc/notifications/$')({
  server: {
    handlers: createTRPCServerHandlers({
      endpoint: '/api/trpc/notifications',
      router: appRouter,
      createContext: createTRPCContext,
    }),
  },
});
