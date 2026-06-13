'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';

import { useTRPC } from '../../trpc/react';

export function StripeSuccessRedirect() {
  const router = useRouter();
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  useEffect(() => {
    // Invalidate the relevant queries after the server has synced the data
    const invalidateAndRedirect = () => {
      try {
        void queryClient.invalidateQueries(
          trpc.account.getCreditUsage.pathFilter(),
        );
        void queryClient.invalidateQueries(
          trpc.account.getSubscriptionDetails.pathFilter(),
        );

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
  }, [router]);

  return null; // This component doesn't render anything
}
