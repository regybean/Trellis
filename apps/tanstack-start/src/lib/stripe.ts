import { auth } from '@clerk/tanstack-react-start/server';
import { redirect } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';

import { syncStripeDataToKV } from '@acme/billing/server';
import { getStripeCustomerId } from '@acme/subscriptions';

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
