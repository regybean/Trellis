'use client';

import { useQueryClient } from '@tanstack/react-query';

import { useTRPC } from '../trpc/react';

/**
 * Invalidates the Subscription + Credit-usage caches after Stripe has synced a
 * checkout on the server, so the UI reflects the new Subscription. The redirect
 * timing/navigation is left to the (framework-specific) app-facing component.
 */
export function useBillingSync() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return {
    invalidateSubscription: () => {
      void queryClient.invalidateQueries(
        trpc.account.getCreditUsage.pathFilter(),
      );
      void queryClient.invalidateQueries(
        trpc.account.getSubscriptionDetails.pathFilter(),
      );
    },
  };
}
