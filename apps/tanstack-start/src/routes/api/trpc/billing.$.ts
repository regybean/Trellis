import { createFileRoute } from '@tanstack/react-router';

import { appRouter } from '@acme/billing/server';

import { resolveAuthContextWithEntitlements } from '~/lib/trpc-context';
import { createTRPCServerHandlers } from '~/lib/trpc-route';

export const Route = createFileRoute('/api/trpc/billing/$')({
  server: {
    handlers: createTRPCServerHandlers({
      endpoint: '/api/trpc/billing',
      router: appRouter,
      resolver: resolveAuthContextWithEntitlements,
    }),
  },
});
