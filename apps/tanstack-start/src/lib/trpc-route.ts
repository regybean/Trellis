import type { AnyRouter } from '@trpc/server';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';

import { resolveClerkContext } from '~/lib/clerk-context';

/**
 * App-owned tRPC route-handler seam for TanStack Start. Every feature's
 * `/api/trpc/<feature>` mount shares the same fetch-adapter wiring — Clerk auth
 * resolution (via `resolveClerkContext`), entitlements injection, and error
 * logging — so it lives here once. Feature route files keep only the framework
 * seam (`createFileRoute` with its path literal, which the route-tree codegen
 * statically requires) and a tiny declaration of "this router at this
 * endpoint" (see `createTRPCServerHandlers`).
 *
 * The fetch adapter serves the `chat.stream` SSE subscription over the same GET
 * handler (`httpSubscriptionLink`), so SSE rides this route through Nitro with
 * no extra wiring.
 */

type ContextInput = Awaited<ReturnType<typeof resolveClerkContext>>;

interface TRPCRouteOptions<TRouter extends AnyRouter> {
  /** The tRPC endpoint path, e.g. `/api/trpc/chat`. */
  endpoint: string;
  /** The feature's aggregated app router. */
  router: TRouter;
  /** The feature's `createTRPCContext` (re-exported from the platform seam). */
  createContext: (input: ContextInput) => Promise<unknown>;
}

/**
 * Build the `server.handlers` map for a feature's tRPC mount. The same fetch
 * handler serves both GET and POST (the latter for mutations, the former also
 * carrying `httpSubscriptionLink` SSE streams such as `chat.stream`).
 */
export function createTRPCServerHandlers<TRouter extends AnyRouter>({
  endpoint,
  router,
  createContext,
}: TRPCRouteOptions<TRouter>) {
  const handler = (req: Request) =>
    fetchRequestHandler({
      endpoint,
      req,
      router,
      createContext: async () => createContext(await resolveClerkContext(req)),
      onError: ({ path, error }) => {
        console.error(
          `❌ tRPC failed on ${path ?? '<no-path>'}: ${error.message}`,
        );
      },
    });

  return {
    GET: ({ request }: { request: Request }) => handler(request),
    POST: ({ request }: { request: Request }) => handler(request),
  };
}
