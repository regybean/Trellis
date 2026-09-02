import { redirect } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { getRequestHeaders } from '@tanstack/react-start/server';

import { localstripeMode, syncStripeDataToKV } from '@acme/billing/server';
import { getStripeCustomerId } from '@acme/subscriptions';

import { auth } from '~/lib/auth-server';

/**
 * Server-derived localstripe mode (ADR 0003/0004), surfaced to the client
 * through the root route context → `BillingConfigProvider` seam so the client
 * reads one mode value instead of proxying it through `NODE_ENV`. A server
 * function guarantees the Stripe connection (billing env, server side, ADR 0033
 * §6) is read on the server; the client can’t reach a server key.
 */
export const getLocalstripeMode = createServerFn({ method: 'GET' }).handler(
  () => localstripeMode,
);

/**
 * App-owned Stripe-success sync, the framework-specific replacement for the
 * Next.js `StripeSuccessHandler` RSC (`@acme/billing/server-next`). Reuses the
 * neutral `syncStripeDataToKV` from `@acme/billing/server`; only the session
 * resolution + redirect glue is per-app.
 *
 * The principal Stripe is keyed on is Better Auth's user id — the same id
 * `protectedProcedure` gates on, because both come off the resolved session
 * (ADR 0034). Under Clerk this was Clerk's `userId`, so an existing deployment's
 * `stripeCustomerId` mappings in Redis are keyed on identities that no longer
 * exist; that is the migration cost ADR 0034 names, not a bug here.
 */
export const syncStripeOnSuccess = createServerFn({ method: 'POST' }).handler(
  async () => {
    const session = await auth.api.getSession({ headers: getRequestHeaders() });
    if (!session) {
      throw redirect({ to: '/sign-in' });
    }

    const stripeCustomerId = await getStripeCustomerId(session.user.id);
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
