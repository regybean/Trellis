import type { AnyRouter } from '@trpc/server';

import type { InjectedSession } from '@acme/trpc';
import { unlimitedEntitlements } from '@acme/entitlements';
import {
  corsPreflightHeaders,
  createTRPCFetchHandler,
} from '@acme/trpc/handler';

/**
 * App-owned tRPC route-handler seam for the slim (no-auth, no-billing) Next.js
 * app. The fetch-adapter wiring, error logging and CORS live once in
 * `@acme/trpc/handler`; this file owns only the app-specific seam — injecting a
 * constant local principal in place of auth, and `unlimitedEntitlements` into
 * the one mount that asks for a provider (ADR 0010).
 */

/**
 * Constant local principal. This app strips auth, but the feature procedures
 * still require a principal: `@acme/chat` is `protectedProcedure` (scopes Mastra
 * memory by a non-null principal) and `@acme/ingest` is `adminProcedure` (gates
 * on the principal's `role`). So we inject a single fixed admin user — the whole
 * session, with no provider behind it. See ADR-0006 and ADR-0010.
 */
const LOCAL_SESSION: InjectedSession = {
  user: { id: 'local', role: 'admin' },
};

/**
 * Shape the neutral base context every mount receives. No auth: a constant admin
 * principal, injected directly.
 */
const resolveContext = (req: Request) => ({
  headers: req.headers,
  req,
  session: LOCAL_SESSION,
});

/**
 * The base context plus the no-op `unlimitedEntitlements` (top tier, infinite
 * credits) — the **context extension** `@acme/chat` declares (#256, ADR 0006).
 * This app strips billing but still mounts chat, which meters credits, so it is
 * choosing *unmetered* rather than declining to choose. Injected per mount, so
 * `ingest` and `notifications` — which have no tier to gate on and no credit to
 * spend — are handed nothing.
 */
const resolveContextWithEntitlements = (req: Request) => ({
  ...resolveContext(req),
  entitlements: unlimitedEntitlements,
});

/** CORS preflight: a 204 with the shared cross-app CORS policy. */
const handleOptions = () =>
  new Response(null, { status: 204, headers: corsPreflightHeaders });

interface TRPCRouteOptions<TRouter extends AnyRouter, TContextInput> {
  /** The tRPC endpoint path, e.g. `/api/trpc/chat`. */
  endpoint: string;
  /** The feature's aggregated app router. */
  router: TRouter;
  /** The feature's `createTRPCContext` (re-exported from the platform seam). */
  createContext: (input: TContextInput) => Promise<unknown>;
}

/**
 * Build a route-handler factory bound to one context resolver. Currying is what
 * pins `TContextInput` before a feature's `createTRPCContext` is checked against
 * it: a mount whose feature declares a context extension the bound resolver does
 * not produce fails to compile, which is the whole point of injecting the
 * provider per mount.
 */
function routeHandlersFor<TContextInput>(
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

    return { GET: handler, POST: handler, OPTIONS: handleOptions };
  };
}

/**
 * Build the Next.js route handlers for a feature's tRPC mount. The same fetch
 * handler serves both GET and POST (the latter for mutations, the former also
 * carrying `httpSubscriptionLink` SSE streams such as `chat.stream`).
 */
export const createTRPCRouteHandlers = routeHandlersFor(resolveContext);

/**
 * As `createTRPCRouteHandlers`, for a feature whose context extension is the
 * entitlements provider — here that is `@acme/chat` alone.
 */
export const createTRPCRouteHandlersWithEntitlements = routeHandlersFor(
  resolveContextWithEntitlements,
);
