import type { AnyRouter } from '@trpc/server';
import type { NextRequest } from 'next/server';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';

import type { InjectedAuth } from '@acme/trpc';
import { unlimitedEntitlements } from '@acme/entitlements';
import { logTRPCError } from '@acme/trpc/error';

/**
 * App-owned tRPC route-handler seam for the slim (no-auth, no-billing) Next.js
 * app. Every feature's `/api/trpc/<feature>` mount shares the same fetch-adapter
 * wiring — CORS, principal injection, entitlements, and error logging — so it
 * lives here once. Feature route files become tiny declarations of "this router
 * at this endpoint" (see `createTRPCRouteHandlers`).
 *
 * Changing CORS, context construction, or error handling for the whole app
 * happens in this single file.
 */

/**
 * Constant local principal. This app strips Clerk, but the feature procedures
 * still require a principal: `@acme/chat` is `protectedProcedure` (scopes Mastra
 * memory by a non-null `userId`) and `@acme/ingest` is `adminProcedure` (gates on
 * `sessionClaims.metadata.role === 'admin'`). So we inject a single fixed admin
 * user. `user` is null — no retained feature reads `ctx.user`. See ADR-0006.
 */
const LOCAL_PRINCIPAL: InjectedAuth = {
  userId: 'local',
  sessionClaims: { metadata: { role: 'admin' } },
};

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
 * Shape the neutral context input the feature `createTRPCContext` expects. No
 * Clerk, no billing: a constant admin principal and the no-op
 * `unlimitedEntitlements` (top tier, infinite credits) are injected directly.
 */
const buildContextInput = (req: NextRequest) => ({
  headers: req.headers,
  req,
  auth: LOCAL_PRINCIPAL,
  user: null,
  entitlements: unlimitedEntitlements,
});

type ContextInput = ReturnType<typeof buildContextInput>;

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
      createContext: async () => createContext(buildContextInput(req)),
      onError: logTRPCError,
    });

  return { GET: handler, POST: handler, OPTIONS: handleOptions };
}
