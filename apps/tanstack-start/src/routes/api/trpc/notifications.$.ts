import { createFileRoute } from '@tanstack/react-router';

import { appRouter } from '@acme/notifications/server';

import { resolveAuthContext } from '~/lib/trpc-context';
import { createTRPCServerHandlers } from '~/lib/trpc-route';

export const Route = createFileRoute('/api/trpc/notifications/$')({
  server: {
    handlers: createTRPCServerHandlers({
      endpoint: '/api/trpc/notifications',
      router: appRouter,
      resolver: resolveAuthContext,
    }),
  },
});
