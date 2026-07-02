'use client';

import { useQuery } from '@tanstack/react-query';

import { useAuth } from '@acme/auth';

import { useTRPC } from '../trpc/react';

/**
 * Reads the viewer's Subscription details and Credit usage for the account
 * modal. Gated on Clerk being loaded + signed in. Keeps `NavUserSubscription`
 * UI-only.
 */
export function useSubscriptionDetails() {
  const trpc = useTRPC();
  const { isSignedIn, isLoaded } = useAuth();

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
