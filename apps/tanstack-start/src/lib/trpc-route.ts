import type { BaseContext } from '@acme/trpc';
import type { TRPCFetchHandlerOptions } from '@acme/trpc/handler';
import {
  corsPreflightHeaders,
  createTRPCFetchHandler,
} from '@acme/trpc/handler';

/**
 * App-owned tRPC route-handler seam for TanStack Start. The fetch-adapter
 * wiring, error logging and CORS live once in `@acme/trpc/handler`; this file
 * owns only the framework shape. The app-specific auth seam is
 * `~/lib/trpc-context`'s resolvers, which each mount names. Feature route files
 * keep only the `createFileRoute` path literal (which the route-tree codegen
 * statically requires) and a tiny "this router at this endpoint, with this
 * resolver" declaration.
 *
 * The fetch adapter serves the `chat.stream` SSE subscription over the same GET
 * handler (`httpSubscriptionLink`), so SSE rides this route through Nitro with
 * no extra wiring.
 */

/**
 * Build the `server.handlers` map for a feature's tRPC mount. The same fetch
 * handler serves both GET and POST (the latter for mutations, the former also
 * carrying `httpSubscriptionLink` SSE streams such as `chat.stream`).
 *
 * The mount names its own resolver. `TContext` is inferred from the router, and
 * the resolver is checked against it — so a mount whose feature reads a field
 * this app's resolver doesn't produce (chat's `entitlements`, say) fails to
 * compile. That used to be enforced by currying one resolver per factory and
 * threading the feature's `createTRPCContext` through to be checked against it;
 * the router carries the type on its own (#264).
 */
export function createTRPCServerHandlers<TContext extends BaseContext>(
  opts: TRPCFetchHandlerOptions<TContext>,
) {
  const handler = createTRPCFetchHandler(opts);

  return {
    GET: ({ request }: { request: Request }) => handler(request),
    POST: ({ request }: { request: Request }) => handler(request),
    OPTIONS: () =>
      new Response(null, { status: 204, headers: corsPreflightHeaders }),
  };
}
