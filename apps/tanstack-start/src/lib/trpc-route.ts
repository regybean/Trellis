import type { AnyRouter } from '@trpc/server';

import {
  corsPreflightHeaders,
  createTRPCFetchHandler,
} from '@acme/trpc/handler';

import { resolveClerkContext } from '~/lib/clerk-context';

/**
 * App-owned tRPC route-handler seam for TanStack Start. The fetch-adapter
 * wiring, error logging and CORS live once in `@acme/trpc/handler`; this file
 * owns only the app-specific auth seam (`resolveClerkContext`) and the
 * framework shape. Feature route files keep only the `createFileRoute` path
 * literal (which the route-tree codegen statically requires) and a tiny "this
 * router at this endpoint" declaration.
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
  const handler = createTRPCFetchHandler({
    endpoint,
    router,
    createContext,
    resolver: resolveClerkContext,
  });

  return {
    GET: ({ request }: { request: Request }) => handler(request),
    POST: ({ request }: { request: Request }) => handler(request),
    OPTIONS: () =>
      new Response(null, { status: 204, headers: corsPreflightHeaders }),
  };
}
