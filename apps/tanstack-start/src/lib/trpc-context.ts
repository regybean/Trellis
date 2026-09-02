import { toPrincipal } from '@acme/auth/server';
import { env as billingEnv, toPlanIds } from '@acme/billing/env';
import { createSubscriptionsEntitlements } from '@acme/subscriptions';

import { auth } from '~/lib/auth-server';

/**
 * The Stripe/Redis entitlements provider, closing over the plan ids billing's own
 * env resolves (ADR 0033).
 */
const entitlements = createSubscriptionsEntitlements(toPlanIds(billingEnv));

/**
 * App-owned auth seam: resolve the Better Auth session on the server and map it
 * onto the platform's neutral `InjectedSession`, alongside the Stripe/Redis-backed
 * entitlements provider. Each feature's `createTRPCContext` (re-exported from the
 * platform seam) consumes this — the feature packages never import an auth SDK or
 * a billing implementation themselves.
 *
 * The session comes from the request's own `Headers`, not from an ambient request
 * context: `auth.api.getSession` needs only the `Cookie` header, and the tRPC
 * fetch handler already holds the `Request`. So there is no request middleware
 * for auth at all, and this resolver behaves identically wherever it is called
 * from.
 *
 * Resolving the session is the framework-specific half; the provider-specific
 * mapping onto the neutral principal is `@acme/auth`'s `toPrincipal`, shared with
 * the Next.js app. Every request costs one database read of `session` — auth is
 * stateful now, and a revoked row stops resolving immediately (ADR 0034).
 */
export async function resolveAuthContext(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });

  return {
    headers: req.headers,
    req,
    // The app's own public origin (its PORT in dev, deploy origin in prod), read
    // off the request so billing can build the absolute Stripe checkout redirect
    // URLs from the authored paths (ADR 0033).
    origin: new URL(req.url).origin,
    session: { user: toPrincipal(session) },
    entitlements,
  };
}
