'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { useBillingSync } from '../../hooks/use-billing-sync';

export function StripeSuccessRedirect() {
  const router = useRouter();
  const { invalidateSubscription } = useBillingSync();

  useEffect(() => {
    // Invalidate the relevant queries after the server has synced the data
    const invalidateAndRedirect = () => {
      try {
        invalidateSubscription();

        // Wait a bit more to ensure invalidation is complete
        setTimeout(() => {
          router.push('/');
        }, 1000);
      } catch {
        // Redirect anyway even if invalidation fails
        setTimeout(() => {
          router.push('/');
        }, 1000);
      }
    };

    // Start the invalidation process after a short delay to let the server sync complete
    const timer = setTimeout(() => invalidateAndRedirect(), 2000);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null; // This component doesn't render anything
}
