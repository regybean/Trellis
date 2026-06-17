import type { AnyRouter } from '@trpc/server';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';

import type { InjectedAuth } from '@acme/trpc';
import { unlimitedEntitlements } from '@acme/entitlements';
import { logTRPCError } from '@acme/trpc/error';

/**
 * App-owned tRPC route-handler seam for the slim (no-auth, no-billing) TanStack
 * Start app. Every feature's `/api/trpc/<feature>` mount shares the same
 * fetch-adapter wiring — principal injection, entitlements, and error logging —
 * so it lives here once. Feature route files keep only the framework seam
 * (`createFileRoute` with its path literal, which the route-tree codegen
 * statically requires) and a tiny declaration of "this router at this endpoint"
 * (see `createTRPCServerHandlers`).
 *
 * The fetch adapter serves the `chat.stream` SSE subscription over the same GET
 * handler (`httpSubscriptionLink`), so SSE rides this route through Nitro with
 * no extra wiring.
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
 * Shape the neutral context input the feature `createTRPCContext` expects. No
 * Clerk, no billing: a constant admin principal and the no-op
 * `unlimitedEntitlements` (top tier, infinite credits) are injected directly.
 */
function buildContextInput(req: Request) {
  return {
    headers: req.headers,
    req,
    auth: LOCAL_PRINCIPAL,
    user: null,
    entitlements: unlimitedEntitlements,
  };
}

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
      createContext: async () => createContext(buildContextInput(req)),
      onError: logTRPCError,
    });

  return {
    GET: ({ request }: { request: Request }) => handler(request),
    POST: ({ request }: { request: Request }) => handler(request),
  };
}
