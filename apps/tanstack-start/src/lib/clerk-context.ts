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
 * Map Clerk's session onto the platform's neutral `InjectedSession`. This is the
 * only Clerk-shaped code in the request path: the role moves off the JWT claim
 * and onto the injected user, which is what the platform's `isAdmin` reads.
 *
 * `auth()` reads the Start request context populated by `clerkMiddleware()`
 * (registered in `src/start.ts`); the full user is fetched only when signed in,
 * mirroring the Next.js app's `currentUser()` injection.
 *
 * `Object.assign` rather than a spread because Clerk's `User` exposes
 * `primaryEmailAddress` (which the billing account router reads) as a prototype
 * getter — spreading would drop it. The object is per-request, so mutating it is
 * contained. Branching on `userId` rather than returning `{ user: user && … }`
 * keeps the result a *union* of the two session shapes, which is what narrows.
 */
async function resolveSession() {
  const { userId, sessionClaims } = await auth();
  if (!userId) return { user: null };

  const user = await clerkClient().users.getUser(userId);
  return { user: Object.assign(user, { role: sessionClaims.metadata.role }) };
}

/**
 * App-owned auth seam: resolve Clerk on the server and shape it into the fields
 * the neutral tRPC context expects, alongside the Stripe/Redis-backed
 * entitlements provider. Each feature's `createTRPCContext` (re-exported from
 * the platform seam) consumes this — the feature packages never import a
 * framework Clerk SDK or a billing implementation themselves.
 */
export async function resolveClerkContext(req: Request) {
  return {
    headers: req.headers,
    req,
    // The app's own public origin (its PORT in dev, deploy origin in prod), read
    // off the request so billing can build the absolute Stripe checkout redirect
    // URLs from the config-owned paths (ADR 0026 follow-up).
    origin: new URL(req.url).origin,
    session: await resolveSession(),
    entitlements,
  };
}
