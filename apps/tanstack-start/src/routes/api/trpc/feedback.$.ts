import { createFileRoute } from '@tanstack/react-router';

import { appRouter, createTRPCContext } from '@acme/feedback/server';

import { createTRPCServerHandlers } from '~/lib/trpc-route';

export const Route = createFileRoute('/api/trpc/feedback/$')({
  server: {
    handlers: createTRPCServerHandlers({
      endpoint: '/api/trpc/feedback',
      router: appRouter,
      createContext: createTRPCContext,
    }),
  },
});
