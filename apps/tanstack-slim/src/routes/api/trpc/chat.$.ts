import { createFileRoute } from '@tanstack/react-router';

import { appRouter } from '@acme/chat/server';

import {
  createTRPCServerHandlers,
  resolveContextWithEntitlements,
} from '~/lib/trpc-route';

export const Route = createFileRoute('/api/trpc/chat/$')({
  server: {
    handlers: createTRPCServerHandlers({
      endpoint: '/api/trpc/chat',
      router: appRouter,
      resolver: resolveContextWithEntitlements,
    }),
  },
});
