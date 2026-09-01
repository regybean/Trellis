import { auth, clerkClient } from '@clerk/tanstack-react-start/server';

import { toInjectedPrincipal } from '@acme/auth/server';
import { env as billingEnv, toPlanIds } from '@acme/billing/env';
import { createSubscriptionsEntitlements } from '@acme/subscriptions';

/**
 * The Stripe/Redis entitlements provider, closing over the plan ids billing's own
 * env resolves (ADR 0033).
 */
const entitlements = createSubscriptionsEntitlements(toPlanIds(billingEnv));

/**
 * App-owned auth seam: resolve Clerk on the server and map it onto the platform's
 * neutral `InjectedSession`, alongside the Stripe/Redis-backed entitlements
 * provider. Each feature's `createTRPCContext` (re-exported from the platform
 * seam) consumes this — the feature packages never import a framework Clerk SDK
 * or a billing implementation themselves.
 *
 * `auth()` reads the Start request context populated by `clerkMiddleware()`
 * (registered in `src/start.ts`); the full user is fetched only when signed in,
 * mirroring the Next.js app's `currentUser()` injection. Resolving Clerk is the
 * framework-specific half; the provider-specific mapping onto the neutral
 * principal is `@acme/auth`'s `toInjectedPrincipal`, shared with the Next.js
 * app. The Clerk `User` instance itself never reaches the context.
 */
export async function resolveClerkContext(req: Request) {
  const session = await auth();
  const client = clerkClient();
  const user = session.userId
    ? await client.users.getUser(session.userId)
    : null;

  return {
    headers: req.headers,
    req,
    // The app's own public origin (its PORT in dev, deploy origin in prod), read
    // off the request so billing can build the absolute Stripe checkout redirect
    // URLs from the authored paths (ADR 0033).
    origin: new URL(req.url).origin,
    session: { user: toInjectedPrincipal(session, user) },
    entitlements,
  };
}
