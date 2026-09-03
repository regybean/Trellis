import type { AnyRouter } from '@trpc/server';

import { toPrincipal } from '@acme/auth/server';
import { env as billingEnv, toPlanIds } from '@acme/billing/env';
import { createSubscriptionsEntitlements } from '@acme/subscriptions';
import {
  corsPreflightHeaders,
  createTRPCFetchHandler,
} from '@acme/trpc/handler';

import { auth } from './auth';

/**
 * The Stripe/Redis entitlements provider, closing over the plan ids billing's
 * own env resolves (ADR 0033) — the product→tier mapping needs them, and the
 * platform no longer reads them from `process.env`.
 */
const entitlements = createSubscriptionsEntitlements(toPlanIds(billingEnv));

/**
 * App-owned tRPC route-handler seam for Next.js. The fetch-adapter wiring, error
 * logging and CORS live once in `@acme/trpc/handler`; this file owns only the
 * app-specific auth seam — resolving the session and shaping the neutral context
 * input the feature `createTRPCContext` expects. The feature packages never
 * import an auth SDK or a billing implementation themselves (ADR 0003).
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
 * authenticating immediately (ADR 0034).
 */
const resolveSession = async (req: Request) => ({
  user: toPrincipal(await auth.api.getSession({ headers: req.headers })),
});

/**
 * Shape the neutral base context every mount receives — and nothing more.
 * `origin` is the app's own public origin (its `PORT` in dev, deploy origin in
 * prod), read off the incoming request and threaded in so billing can build the
 * absolute Stripe checkout redirect URLs (ADR 0026 follow-up).
 */
const resolveContext = async (req: Request) => ({
  headers: req.headers,
  req,
  origin: new URL(req.url).origin,
  session: await resolveSession(req),
});

/**
 * The base context plus the entitlements provider — the **context extension**
 * `@acme/chat` and `@acme/billing` declare (#256, ADR 0006). Injected per mount
 * rather than into every context, so the mounts that meter credits or gate tiers
 * get a provider and the mounts that do neither (`feedback`, `ingest`,
 * `notifications`) are handed nothing they cannot name.
 */
const resolveContextWithEntitlements = async (req: Request) => ({
  ...(await resolveContext(req)),
  entitlements,
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
 * entitlements provider — `@acme/chat` (meters credits) and `@acme/billing`
 * (gates tiers). Every other mount uses the plain builder.
 */
export const createTRPCRouteHandlersWithEntitlements = routeHandlersFor(
  resolveContextWithEntitlements,
);
