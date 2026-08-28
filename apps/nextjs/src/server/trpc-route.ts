import type { AnyRouter } from '@trpc/server';
import { auth, currentUser } from '@clerk/nextjs/server';

import { env as billingEnv, toPlanIds } from '@acme/billing/env';
import { createSubscriptionsEntitlements } from '@acme/subscriptions';
import {
  corsPreflightHeaders,
  createTRPCFetchHandler,
} from '@acme/trpc/handler';

/**
 * The Stripe/Redis entitlements provider, closing over the plan ids billing's
 * own env resolves (ADR 0033) — the product→tier mapping needs them, and the
 * platform no longer reads them from `process.env`.
 */
const entitlements = createSubscriptionsEntitlements(toPlanIds(billingEnv));

/**
 * App-owned tRPC route-handler seam for Next.js. The fetch-adapter wiring, error
 * logging and CORS live once in `@acme/trpc/handler`; this file owns only the
 * app-specific auth seam — resolving Clerk and mapping it onto the neutral
 * context input the feature `createTRPCContext` expects. The feature packages
 * never import a framework Clerk SDK or a billing implementation themselves
 * (ADR 0003).
 */

/**
 * Map Clerk's session onto the platform's neutral `InjectedSession`. This is the
 * only Clerk-shaped code in the request path: the role moves off the JWT claim
 * and onto the injected user, which is what the platform's `isAdmin` reads.
 *
 * `Object.assign` rather than a spread because Clerk's `User` exposes
 * `primaryEmailAddress` (which the billing account router reads) as a prototype
 * getter — spreading would drop it. The object is per-request, so mutating it is
 * contained. Branching on `user` rather than returning `{ user: user && … }`
 * keeps the result a *union* of the two session shapes, which is what narrows.
 */
const resolveSession = async () => {
  const { sessionClaims } = await auth();
  const user = await currentUser();
  if (!user) return { user: null };
  return { user: Object.assign(user, { role: sessionClaims?.metadata.role }) };
};

/**
 * App-owned auth seam: resolve Clerk here and shape the neutral context input.
 * `origin` is the app's own public origin (its `PORT` in dev, deploy origin in
 * prod), read off the incoming request and threaded in so billing can build the
 * absolute Stripe checkout redirect URLs (ADR 0026 follow-up).
 */
const resolveContext = async (req: Request) => ({
  headers: req.headers,
  req,
  origin: new URL(req.url).origin,
  session: await resolveSession(),
  entitlements,
});

/** CORS preflight: a 204 with the shared cross-app CORS policy. */
const handleOptions = () =>
  new Response(null, { status: 204, headers: corsPreflightHeaders });

type ContextInput = Awaited<ReturnType<typeof resolveContext>>;

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
  const handler = createTRPCFetchHandler({
    endpoint,
    router,
    createContext,
    resolver: resolveContext,
  });

  return { GET: handler, POST: handler, OPTIONS: handleOptions };
}
