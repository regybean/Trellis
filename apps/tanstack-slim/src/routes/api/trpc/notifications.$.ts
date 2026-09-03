import { createFileRoute } from '@tanstack/react-router';

import { appRouter } from '@acme/notifications/server';

import { createTRPCServerHandlers, resolveContext } from '~/lib/trpc-route';

export const Route = createFileRoute('/api/trpc/notifications/$')({
  server: {
    handlers: createTRPCServerHandlers({
      endpoint: '/api/trpc/notifications',
      router: appRouter,
      resolver: resolveContext,
    }),
  },
});
