'use client';

import { useSubscriptionDetails } from '../hooks/use-subscription-details';
import { SubscriptionDetailsModal } from './subscription-details-modal';

interface NavUserSubscriptionProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NavUserSubscription({
  isOpen,
  onOpenChange,
}: NavUserSubscriptionProps) {
  const { subscriptionData, creditUsageData, isLoading } =
    useSubscriptionDetails();

  return (
    <SubscriptionDetailsModal
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      subscriptionData={subscriptionData}
      creditUsageData={creditUsageData}
      isLoading={isLoading}
    />
  );
}
