'use client';

import { useQuery } from '@tanstack/react-query';

import { useAuthStatus } from '@acme/hooks';

import { useTRPC } from '../trpc/react';

/**
 * Reads the viewer's Subscription details and Credit usage for the account
 * modal. Gated on the app-supplied auth status being loaded + signed in, so the
 * queries never fire before the session resolves. Keeps `NavUserSubscription`
 * UI-only.
 */
export function useSubscriptionDetails() {
  const trpc = useTRPC();
  const { isSignedIn, isLoaded } = useAuthStatus();

  const subscription = useQuery(
    trpc.account.getSubscriptionDetails.queryOptions(undefined, {
      enabled: isLoaded && isSignedIn,
    }),
  );

  const creditUsage = useQuery(
    trpc.account.getCreditUsage.queryOptions(undefined, {
      enabled: isLoaded && isSignedIn,
    }),
  );

  return {
    subscriptionData: subscription.data,
    creditUsageData: creditUsage.data,
    isLoading: subscription.isPending || creditUsage.isPending,
  };
}
