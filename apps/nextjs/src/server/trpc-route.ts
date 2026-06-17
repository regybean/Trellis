import type { AnyRouter } from '@trpc/server';
import type { NextRequest } from 'next/server';
import { auth, currentUser } from '@clerk/nextjs/server';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';

import { subscriptionsEntitlements } from '@acme/subscriptions';
import { logTRPCError } from '@acme/trpc/error';

/**
 * App-owned tRPC route-handler seam for Next.js. Every feature's
 * `/api/trpc/<feature>` mount shares the same fetch-adapter wiring — CORS,
 * Clerk auth resolution, entitlements injection, and error logging — so it
 * lives here once. Feature route files become tiny declarations of "this
 * router at this endpoint" (see `createTRPCRouteHandlers`).
 *
 * Changing CORS, context construction, or error handling for the whole app
 * happens in this single file.
 */

/**
 * Configure basic CORS headers.
 * You should extend this to match your needs.
 */
const setCorsHeaders = (res: Response) => {
  res.headers.set('Access-Control-Allow-Origin', '*');
  res.headers.set('Access-Control-Request-Method', '*');
  res.headers.set('Access-Control-Allow-Methods', 'OPTIONS, GET, POST');
  res.headers.set('Access-Control-Allow-Headers', '*');
};

const handleOptions = () => {
  const response = new Response(null, { status: 204 });
  setCorsHeaders(response);
  return response;
};

/**
 * App-owned auth seam: resolve Clerk here and shape the neutral context input
 * the feature `createTRPCContext` expects. The feature packages never import a
 * framework Clerk SDK or a billing implementation themselves.
 */
const buildContextInput = async (req: NextRequest) => ({
  headers: req.headers,
  req,
  auth: await auth(),
  user: await currentUser(),
  entitlements: subscriptionsEntitlements,
});

type ContextInput = Awaited<ReturnType<typeof buildContextInput>>;

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
  const handler = (req: NextRequest) =>
    fetchRequestHandler({
      endpoint,
      req,
      router,
      createContext: async () => createContext(await buildContextInput(req)),
      onError: logTRPCError,
    });

  return { GET: handler, POST: handler, OPTIONS: handleOptions };
}
