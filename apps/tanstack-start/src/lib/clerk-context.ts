import { auth, clerkClient } from '@clerk/tanstack-react-start/server';

import { toPlanIds } from '@acme/billing/config';
import { createSubscriptionsEntitlements } from '@acme/subscriptions';

import { config } from '../config';

/**
 * The Stripe/Redis entitlements provider, closing over the `billingConfig` plan
 * IDs resolved once at the app edge (ADR 0026).
 */
const entitlements = createSubscriptionsEntitlements(toPlanIds(config));

/**
 * App-owned auth seam: resolve Clerk on the server (session auth + full user)
 * and shape it into the fields the neutral tRPC context expects, alongside the
 * Stripe/Redis-backed entitlements provider. Each feature's `createTRPCContext`
 * (re-exported from the platform seam) consumes this — the feature packages
 * never import a framework Clerk SDK or a billing implementation themselves.
 *
 * `auth()` reads the Start request context populated by `clerkMiddleware()`
 * (registered in `src/start.ts`); the full user is fetched only when signed in,
 * mirroring the Next.js app's `currentUser()` injection.
 */
export async function resolveClerkContext(req: Request) {
  const authObject = await auth();
  const client = clerkClient();
  const user = authObject.userId
    ? await client.users.getUser(authObject.userId)
    : null;

  return {
    headers: req.headers,
    req,
    // The app's own public origin (its PORT in dev, deploy origin in prod), read
    // off the request so billing can build the absolute Stripe checkout redirect
    // URLs from the config-owned paths (ADR 0026 follow-up).
    origin: new URL(req.url).origin,
    auth: authObject,
    user,
    entitlements,
  };
}
