import { createFileRoute } from '@tanstack/react-router';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';

import { appRouter, createTRPCContext } from '@acme/chat/server';

import { resolveClerkContext } from '~/lib/clerk-context';

// Chat includes the `chat.stream` SSE subscription; tRPC's fetch adapter serves
// it over the same GET handler (httpSubscriptionLink), so SSE rides this route
// through Nitro with no extra wiring.
const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: '/api/trpc/chat',
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

export const Route = createFileRoute('/api/trpc/chat/$')({
  server: {
    handlers: {
      GET: ({ request }) => handler(request),
      POST: ({ request }) => handler(request),
    },
  },
});
