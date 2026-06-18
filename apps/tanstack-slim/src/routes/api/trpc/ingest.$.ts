import { createFileRoute } from '@tanstack/react-router';

import { appRouter, createTRPCContext } from '@acme/ingest/server';

import { createTRPCServerHandlers } from '~/lib/trpc-route';

export const Route = createFileRoute('/api/trpc/ingest/$')({
  server: {
    handlers: createTRPCServerHandlers({
      endpoint: '/api/trpc/ingest',
      router: appRouter,
      createContext: createTRPCContext,
    }),
  },
});
