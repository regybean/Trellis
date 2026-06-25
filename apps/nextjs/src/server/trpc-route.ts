import type { AnyRouter } from '@trpc/server';
import { auth, currentUser } from '@clerk/nextjs/server';

import { subscriptionsEntitlements } from '@acme/subscriptions';
import {
  corsPreflightHeaders,
  createTRPCFetchHandler,
} from '@acme/trpc/handler';

/**
 * App-owned tRPC route-handler seam for Next.js. The fetch-adapter wiring, error
 * logging and CORS live once in `@acme/trpc/handler`; this file owns only the
 * app-specific auth seam — resolving Clerk and shaping the neutral context input
 * the feature `createTRPCContext` expects. The feature packages never import a
 * framework Clerk SDK or a billing implementation themselves (ADR 0003).
 */

/**
 * App-owned auth seam: resolve Clerk here and shape the neutral context input.
 */
const resolveContext = async (req: Request) => ({
  headers: req.headers,
  req,
  auth: await auth(),
  user: await currentUser(),
  entitlements: subscriptionsEntitlements,
});

/** CORS preflight: a 204 with the shared cross-app CORS policy. */
const handleOptions = () =>
  new Response(null, { status: 204, headers: corsPreflightHeaders });

type ContextInput = Awaited<ReturnType<typeof resolveContext>>;

interface TRPCRouteOptions<TRouter extends AnyRouter> {
  /** The tRPC endpoint path, e.g. `/api/trpc/chat`. */
  endpoint: string;
  /** The feature's aggregated app router. */
  router: TRouter;
  /** The feature's `createTRPCContext` (re-exported from the platform seam). */
  createContext: (input: ContextInput) => Promise<unknown>;
}

/**
 * Build the Next.js route handlers for a feature's tRPC mount. The same fetch
 * handler serves both GET and POST (the latter for mutations, the former also
 * carrying `httpSubscriptionLink` SSE streams such as `chat.stream`).
 */
export function createTRPCRouteHandlers<TRouter extends AnyRouter>({
  endpoint,
  router,
  createContext,
}: TRPCRouteOptions<TRouter>) {
  const handler = createTRPCFetchHandler({
    endpoint,
    router,
    createContext,
    resolver: resolveContext,
  });

  return { GET: handler, POST: handler, OPTIONS: handleOptions };
}
