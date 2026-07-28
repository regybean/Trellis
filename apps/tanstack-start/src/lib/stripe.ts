import { auth } from '@clerk/tanstack-react-start/server';
import { redirect } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';

import { localstripeMode, syncStripeDataToKV } from '@acme/billing/server';
import { getStripeCustomerId } from '@acme/subscriptions';

/**
 * Server-derived localstripe mode (ADR 0003/0004), surfaced to the client
 * through the root route context → `BillingConfigProvider` seam so the client
 * reads one mode value instead of proxying it through `NODE_ENV`. A server
 * function guarantees the `STRIPE_API_BASE` read happens on the server; the
 * client can't reach that env directly.
 */
export const getLocalstripeMode = createServerFn({ method: 'GET' }).handler(
  () => localstripeMode,
);

/**
 * App-owned Stripe-success sync, the framework-specific replacement for the
 * Next.js `StripeSuccessHandler` RSC (`@acme/billing/server-next`). Reuses the
 * neutral `syncStripeDataToKV` from `@acme/billing/server`; only the Clerk
 * resolution + redirect glue is per-app.
 */
export const syncStripeOnSuccess = createServerFn({ method: 'POST' }).handler(
  async () => {
    const { userId } = await auth();
    if (!userId) {
      throw redirect({ to: '/sign-in/$', params: { _splat: '' } });
    }

    const stripeCustomerId = await getStripeCustomerId(userId);
    if (!stripeCustomerId) {
      throw redirect({ to: '/' });
    }

    try {
      await syncStripeDataToKV(stripeCustomerId);
    } catch {
      // Don't block the user if the sync fails — webhooks will reconcile.
    }
  },
);
