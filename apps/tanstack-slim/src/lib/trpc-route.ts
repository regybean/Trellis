import type { BaseContext, InjectedSession } from '@acme/trpc';
import type { TRPCFetchHandlerOptions } from '@acme/trpc/handler';
import {
  corsPreflightHeaders,
  createTRPCFetchHandler,
} from '@acme/trpc/handler';

import { entitlements } from '~/server/deps';

/**
 * App-owned tRPC route-handler seam for the slim (no-auth, no-billing) TanStack
 * Start app. The fetch-adapter wiring, error logging and CORS live once in
 * `@acme/trpc/handler`; this file owns only the app-specific seam — injecting a
 * constant local principal in place of auth, and the provider from
 * `~/server/deps` into the one mount that asks for one (@acme/trpc ADR 0003) —
 * and the framework shape.
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
 * still require one: `@acme/chat` and `@acme/ingest` are both
 * `protectedProcedure`, scoping Mastra memory and Data Source ownership by a
 * non-null principal. So we inject a single fixed user — the whole session,
 * with no provider behind it. See apps ADR 0001 and @acme/trpc ADR 0003.
 *
 * No `role`. It used to say `admin`, invented purely to satisfy ingest's
 * `adminProcedure` gate; ingest is owner-scoped now, so a role here would be a
 * claim about an authorization model this app does not have. What it costs is
 * worth naming: with one principal, owner scoping is a tautology here — every
 * row is `local`'s — so the slim apps prove nothing about the privacy boundary.
 * The full apps are where that invariant is exercised.
 */
const LOCAL_SESSION: InjectedSession = {
  user: { id: 'local' },
};

/**
 * The neutral base context every mount receives. No auth: a constant local
 * principal, injected directly. Mounts whose feature context is exactly
 * `BaseContext` (`ingest`, `notifications`) name this resolver.
 */
export const resolveContext = (req: Request) => ({
  headers: req.headers,
  req,
  session: LOCAL_SESSION,
});

/**
 * The base context plus the no-op provider `~/server/deps` builds (top tier,
 * infinite credits) — the extra field `@acme/chat` names on its own context
 * (@acme/entitlements ADR 0001). Chosen per mount, so `ingest` and
 * `notifications` — which
 * have no tier to gate on and no credit to spend — are handed nothing. Which
 * provider this is is the composition root's call, not this file's; `worker.ts`
 * reads the same one.
 */
export const resolveContextWithEntitlements = (req: Request) => ({
  ...resolveContext(req),
  entitlements,
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
