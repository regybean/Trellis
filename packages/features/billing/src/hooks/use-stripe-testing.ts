'use client';

import { useQuery } from '@tanstack/react-query';
import { toast } from 'react-toastify';

import { useTRPC } from '../trpc/react';
import { useBillingRedirect } from './use-billing-redirect';

/**
 * Admin Stripe test panel: create a demo Checkout session and exercise the
 * tier-gated test procedures. Composes the Billing redirect module
 * (use-billing-redirect.ts) for the create-session → toast → navigate flow and
 * its typed billing-error → toast mapping, reusing that same mapping for the
 * feature-test failures. Keeps `StripeTesting` UI-only.
 */
export function useStripeTesting() {
  const trpc = useTRPC();
  const redirect = useBillingRedirect({
    checkout: 'Redirecting to Stripe checkout...',
  });

  const standardFeature = useQuery(
    trpc.account.standardFeature.queryOptions(undefined, {
      enabled: false,
      retry: false,
    }),
  );
  const proFeature = useQuery(
    trpc.account.proFeature.queryOptions(undefined, {
      enabled: false,
      retry: false,
    }),
  );

  const runFeatureTest = async (which: 'standard' | 'pro') => {
    const { data, error } =
      which === 'standard'
        ? await standardFeature.refetch()
        : await proFeature.refetch();
    if (error) {
      redirect.handleBillingError(error);
    } else if (data) {
      toast.success(data.message, { autoClose: 2500 });
    }
  };

  return {
    testCheckout: (productId: string) => redirect.checkout(productId),
    isCreatingCheckout: redirect.isPending,
    runFeatureTest,
  };
}
