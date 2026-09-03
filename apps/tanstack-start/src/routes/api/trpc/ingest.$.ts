import { createFileRoute } from '@tanstack/react-router';

import { appRouter } from '@acme/ingest/server';

import { resolveAuthContext } from '~/lib/trpc-context';
import { createTRPCServerHandlers } from '~/lib/trpc-route';

export const Route = createFileRoute('/api/trpc/ingest/$')({
  server: {
    handlers: createTRPCServerHandlers({
      endpoint: '/api/trpc/ingest',
      router: appRouter,
      resolver: resolveAuthContext,
    }),
  },
});
