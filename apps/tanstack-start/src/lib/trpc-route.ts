import type { AnyRouter } from '@trpc/server';

import {
  corsPreflightHeaders,
  createTRPCFetchHandler,
} from '@acme/trpc/handler';

import {
  resolveAuthContext,
  resolveAuthContextWithEntitlements,
} from '~/lib/trpc-context';

/**
 * App-owned tRPC route-handler seam for TanStack Start. The fetch-adapter
 * wiring, error logging and CORS live once in `@acme/trpc/handler`; this file
 * owns only the app-specific auth seam (`resolveAuthContext`) and the
 * framework shape. Feature route files keep only the `createFileRoute` path
 * literal (which the route-tree codegen statically requires) and a tiny "this
 * router at this endpoint" declaration.
 *
 * The fetch adapter serves the `chat.stream` SSE subscription over the same GET
 * handler (`httpSubscriptionLink`), so SSE rides this route through Nitro with
 * no extra wiring.
 */

interface TRPCRouteOptions<TRouter extends AnyRouter, TContextInput> {
  /** The tRPC endpoint path, e.g. `/api/trpc/chat`. */
  endpoint: string;
  /** The feature's aggregated app router. */
  router: TRouter;
  /** The feature's `createTRPCContext` (re-exported from the platform seam). */
  createContext: (input: TContextInput) => Promise<unknown>;
}

/**
 * Build a server-handlers factory bound to one context resolver. Currying is
 * what pins `TContextInput` before a feature's `createTRPCContext` is checked
 * against it: a mount whose feature declares a context extension the bound
 * resolver does not produce fails to compile, which is the whole point of
 * injecting the provider per mount.
 */
function serverHandlersFor<TContextInput>(
  resolver: (req: Request) => TContextInput | Promise<TContextInput>,
) {
  return <TRouter extends AnyRouter>({
    endpoint,
    router,
    createContext,
  }: TRPCRouteOptions<TRouter, TContextInput>) => {
    const handler = createTRPCFetchHandler({
      endpoint,
      router,
      createContext,
      resolver,
    });

    return {
      GET: ({ request }: { request: Request }) => handler(request),
      POST: ({ request }: { request: Request }) => handler(request),
      OPTIONS: () =>
        new Response(null, { status: 204, headers: corsPreflightHeaders }),
    };
  };
}

/**
 * Build the `server.handlers` map for a feature's tRPC mount. The same fetch
 * handler serves both GET and POST (the latter for mutations, the former also
 * carrying `httpSubscriptionLink` SSE streams such as `chat.stream`).
 */
export const createTRPCServerHandlers = serverHandlersFor(resolveAuthContext);

/**
 * As `createTRPCServerHandlers`, for a feature whose context extension is the
 * entitlements provider — `@acme/chat` (meters credits) and `@acme/billing`
 * (gates tiers). Every other mount uses the plain builder.
 */
export const createTRPCServerHandlersWithEntitlements = serverHandlersFor(
  resolveAuthContextWithEntitlements,
);
