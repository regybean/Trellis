import type { BaseContext } from '@acme/trpc';
import type { TRPCFetchHandlerOptions } from '@acme/trpc/handler';
import { toPrincipal } from '@acme/auth/server';
import {
  corsPreflightHeaders,
  createTRPCFetchHandler,
} from '@acme/trpc/handler';

import { auth } from './auth';
import { entitlements } from './deps';

/**
 * App-owned tRPC route-handler seam for Next.js. The fetch-adapter wiring, error
 * logging and CORS live once in `@acme/trpc/handler`; this file owns only the
 * app-specific auth seam — resolving the session and building the context a
 * feature's procedures read. The feature packages never import an auth SDK or a
 * billing implementation themselves (ADR 0003).
 */

/**
 * App-owned auth seam: resolve the Better Auth session here and map it onto the
 * platform's neutral `InjectedSession`. Resolution is app-owned; the mapping is
 * not — `toPrincipal` is `@acme/auth/server`'s, shared with
 * `apps/tanstack-start`, because it is provider-specific rather than
 * framework-specific (ADR 0003). The principal carries only what the substrate
 * and the features read; the Better Auth session object itself never reaches the
 * context.
 *
 * The request's own headers are passed rather than `next/headers`, so the
 * resolution is tied to the request being served — this runs from a route
 * handler, where the two are the same, and being explicit keeps it that way.
 *
 * This is a database read of the session row on every call, by design: sessions
 * are stateful and the cookie cache is off, so a revoked session stops
 * authenticating immediately (@acme/auth ADR 0001).
 */
const resolveSession = async (req: Request) => ({
  user: toPrincipal(await auth.api.getSession({ headers: req.headers })),
});

/**
 * The neutral base context every mount receives — and nothing more. Mounts whose
 * feature context is exactly `BaseContext` (`feedback`, `ingest`,
 * `notifications`) name this resolver.
 *
 * `origin` is the app's own public origin (its `PORT` in dev, deploy origin in
 * prod), read off the incoming request and threaded in so billing can build the
 * absolute Stripe checkout redirect URLs (#146).
 */
export const resolveContext = async (req: Request) => ({
  headers: req.headers,
  req,
  origin: new URL(req.url).origin,
  session: await resolveSession(req),
});

/**
 * The base context plus the entitlements provider — the extra field `@acme/chat`
 * and `@acme/billing` name on their own contexts (#256, ADR 0006). Chosen per
 * mount rather than injected into every context, so the mounts that meter
 * credits or gate tiers get a provider and the mounts that do neither are handed
 * nothing they cannot name.
 *
 * The provider comes from `./deps`, this app's composition root — the same value
 * `worker.ts` refunds through, because there is only one (ADR 0006).
 */
export const resolveContextWithEntitlements = async (req: Request) => ({
  ...(await resolveContext(req)),
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
