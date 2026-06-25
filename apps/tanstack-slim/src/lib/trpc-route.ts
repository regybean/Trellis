import type { AnyRouter } from '@trpc/server';

import type { InjectedAuth } from '@acme/trpc';
import { unlimitedEntitlements } from '@acme/entitlements';
import {
  corsPreflightHeaders,
  createTRPCFetchHandler,
} from '@acme/trpc/handler';

/**
 * App-owned tRPC route-handler seam for the slim (no-auth, no-billing) TanStack
 * Start app. The fetch-adapter wiring, error logging and CORS live once in
 * `@acme/trpc/handler`; this file owns only the app-specific seam — injecting a
 * constant local principal and `unlimitedEntitlements` in place of Clerk +
 * billing (ADR 0010) — and the framework shape. Feature route files keep only
 * the `createFileRoute` path literal (which the route-tree codegen statically
 * requires) and a tiny "this router at this endpoint" declaration.
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
const resolveContext = (req: Request) => ({
  headers: req.headers,
  req,
  auth: LOCAL_PRINCIPAL,
  user: null,
  entitlements: unlimitedEntitlements,
});

type ContextInput = ReturnType<typeof resolveContext>;

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
    resolver: resolveContext,
  });

  return {
    GET: ({ request }: { request: Request }) => handler(request),
    POST: ({ request }: { request: Request }) => handler(request),
    OPTIONS: () =>
      new Response(null, { status: 204, headers: corsPreflightHeaders }),
  };
}
