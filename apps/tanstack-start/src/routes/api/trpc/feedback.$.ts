import { createFileRoute } from '@tanstack/react-router';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';

import { appRouter, createTRPCContext } from '@acme/feedback/server';

import { resolveClerkContext } from '~/lib/clerk-context';

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: '/api/trpc/feedback',
    req,
    router: appRouter,
    createContext: async () =>
      createTRPCContext(await resolveClerkContext(req)),
    onError: ({ path, error }) => {
      console.error(
        `❌ tRPC failed on ${path ?? '<no-path>'}: ${error.message}`,
      );
    },
  });

export const Route = createFileRoute('/api/trpc/feedback/$')({
  server: {
    handlers: {
      GET: ({ request }) => handler(request),
      POST: ({ request }) => handler(request),
    },
  },
});
