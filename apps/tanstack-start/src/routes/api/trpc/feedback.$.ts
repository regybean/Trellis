import { createFileRoute } from '@tanstack/react-router';

import { appRouter } from '@acme/feedback/server';

import { resolveAuthContext } from '~/lib/trpc-context';
import { createTRPCServerHandlers } from '~/lib/trpc-route';

export const Route = createFileRoute('/api/trpc/feedback/$')({
  server: {
    handlers: createTRPCServerHandlers({
      endpoint: '/api/trpc/feedback',
      router: appRouter,
      resolver: resolveAuthContext,
    }),
  },
});
