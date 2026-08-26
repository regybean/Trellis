import type { AnyRouter } from '@trpc/server';
import { auth, currentUser } from '@clerk/nextjs/server';

import { readRole } from '@acme/auth/server';
import { toPlanIds } from '@acme/billing/config';
import { createSubscriptionsEntitlements } from '@acme/subscriptions';
import {
  corsPreflightHeaders,
  createTRPCFetchHandler,
} from '@acme/trpc/handler';

import { config } from '../config';

/**
 * The Stripe/Redis entitlements provider, closing over the `billingConfig` plan
 * IDs resolved once at the app edge (ADR 0026) — the product→tier mapping needs
 * them, and the platform no longer reads them from `process.env`.
 */
const entitlements = createSubscriptionsEntitlements(toPlanIds(config));

/**
 * App-owned tRPC route-handler seam for Next.js. The fetch-adapter wiring, error
 * logging and CORS live once in `@acme/trpc/handler`; this file owns only the
 * app-specific auth seam — resolving Clerk and shaping the neutral context input
 * the feature `createTRPCContext` expects. The feature packages never import a
 * framework Clerk SDK or a billing implementation themselves (ADR 0003).
 */

/**
 * App-owned auth seam: resolve Clerk here and map it onto the platform's neutral
 * `InjectedSession`. The principal carries only what the substrate and the
 * features read — the id, the role (from the session token, via `@acme/auth`)
 * and the primary email billing opens a Stripe customer with. The Clerk `User`
 * instance itself never reaches the context.
 */
const resolveSession = async () => {
  const [session, user] = await Promise.all([auth(), currentUser()]);

  return {
    user: user && {
      id: user.id,
      role: readRole(session) ?? undefined,
      primaryEmailAddress: user.primaryEmailAddress,
    },
  };
};

/**
 * Shape the neutral context input the feature `createTRPCContext` expects.
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
