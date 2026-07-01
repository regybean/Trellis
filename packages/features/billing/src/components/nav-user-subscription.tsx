'use client';

import { useQuery } from '@tanstack/react-query';

import { useAuth } from '@acme/auth';

import { useTRPC } from '../index';
import { SubscriptionDetailsModal } from './subscription-details-modal';

interface NavUserSubscriptionProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NavUserSubscription({
  isOpen,
  onOpenChange,
}: NavUserSubscriptionProps) {
  const { isSignedIn, isLoaded } = useAuth();
  const trpc = useTRPC();

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

  return (
    <SubscriptionDetailsModal
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      subscriptionData={subscription.data}
      creditUsageData={creditUsage.data}
      isLoading={subscription.isPending || creditUsage.isPending}
    />
  );
}
