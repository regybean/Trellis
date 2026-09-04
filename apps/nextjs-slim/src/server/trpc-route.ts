import type { BaseContext, InjectedSession } from '@acme/trpc';
import type { TRPCFetchHandlerOptions } from '@acme/trpc/handler';
import {
  corsPreflightHeaders,
  createTRPCFetchHandler,
} from '@acme/trpc/handler';

import { entitlements } from './deps';

/**
 * App-owned tRPC route-handler seam for the slim (no-auth, no-billing) Next.js
 * app. The fetch-adapter wiring, error logging and CORS live once in
 * `@acme/trpc/handler`; this file owns only the app-specific seam — injecting a
 * constant local principal in place of auth, and the provider from `./deps` into
 * the one mount that asks for one (ADR 0010).
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
 * The neutral base context every mount receives. No auth: a constant admin
 * principal, injected directly. Mounts whose feature context is exactly
 * `BaseContext` (`ingest`, `notifications`) name this resolver.
 */
export const resolveContext = (req: Request) => ({
  headers: req.headers,
  req,
  session: LOCAL_SESSION,
});

/**
 * The base context plus the no-op provider `./deps` builds (top tier, infinite
 * credits) — the extra field `@acme/chat` names on its own context (#256, ADR
 * 0006). Chosen per mount, so `ingest` and `notifications` — which have no tier
 * to gate on and no credit to spend — are handed nothing. Which provider this is
 * is the composition root's call, not this file's; `worker.ts` reads the same
 * one.
 */
export const resolveContextWithEntitlements = (req: Request) => ({
  ...resolveContext(req),
  entitlements,
});

/** CORS preflight: a 204 with the shared cross-app CORS policy. */
const handleOptions = () =>
  new Response(null, { status: 204, headers: corsPreflightHeaders });

/**
 * Build the Next.js route handlers for a feature's tRPC mount. The same fetch
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
export function createTRPCRouteHandlers<TContext extends BaseContext>(
  opts: TRPCFetchHandlerOptions<TContext>,
) {
  const handler = createTRPCFetchHandler(opts);

  return { GET: handler, POST: handler, OPTIONS: handleOptions };
}
