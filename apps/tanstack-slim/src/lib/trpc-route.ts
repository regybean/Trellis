import type { BaseContext, InjectedSession } from '@acme/trpc';
import type { TRPCFetchHandlerOptions } from '@acme/trpc/handler';
import { unlimitedEntitlements } from '@acme/entitlements';
import {
  corsPreflightHeaders,
  createTRPCFetchHandler,
} from '@acme/trpc/handler';

/**
 * App-owned tRPC route-handler seam for the slim (no-auth, no-billing) TanStack
 * Start app. The fetch-adapter wiring, error logging and CORS live once in
 * `@acme/trpc/handler`; this file owns only the app-specific seam — injecting a
 * constant local principal in place of auth, and `unlimitedEntitlements` into
 * the one mount that asks for a provider (ADR 0010) — and the framework shape.
 * Feature route files keep only the `createFileRoute` path literal (which the
 * route-tree codegen statically requires) and a tiny "this router at this
 * endpoint, with this resolver" declaration.
 *
 * The fetch adapter serves the `chat.stream` SSE subscription over the same GET
 * handler (`httpSubscriptionLink`), so SSE rides this route through Nitro with
 * no extra wiring.
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
 * The base context plus the no-op `unlimitedEntitlements` (top tier, infinite
 * credits) — the extra field `@acme/chat` names on its own context (#256, ADR
 * 0006). This app strips billing but still mounts chat, which meters credits, so
 * it is choosing *unmetered* rather than declining to choose. Chosen per mount,
 * so `ingest` and `notifications` — which have no tier to gate on and no credit
 * to spend — are handed nothing.
 */
export const resolveContextWithEntitlements = (req: Request) => ({
  ...resolveContext(req),
  entitlements: unlimitedEntitlements,
});

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
