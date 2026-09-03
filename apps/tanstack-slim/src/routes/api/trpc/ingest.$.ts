import { createFileRoute } from '@tanstack/react-router';

import { appRouter } from '@acme/ingest/server';

import { createTRPCServerHandlers, resolveContext } from '~/lib/trpc-route';

export const Route = createFileRoute('/api/trpc/ingest/$')({
  server: {
    handlers: createTRPCServerHandlers({
      endpoint: '/api/trpc/ingest',
      router: appRouter,
      resolver: resolveContext,
    }),
  },
});
