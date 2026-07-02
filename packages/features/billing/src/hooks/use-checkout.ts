'use client';

import React from 'react';
import { useMutation } from '@tanstack/react-query';
import { CreditCard } from 'lucide-react';
import { toast } from 'react-toastify';

import { useGenericErrorHandler } from '@acme/hooks';

import { useTRPC } from '../trpc/react';

/**
 * Deep module for the Stripe billing flows a viewer can trigger from the UI:
 * creating a Checkout session (new Subscription) or a Billing portal session
 * (manage an existing one), plus the post-mutation browser redirect.
 *
 * Runtime-agnostic: navigates via `globalThis.location`, not next/navigation,
 * so the hook runs unchanged under any app framework.
 */
export function useCheckout() {
  const trpc = useTRPC();
  const handleError = useGenericErrorHandler();

  const [redirectUrl, setRedirectUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (redirectUrl) {
      globalThis.location.href = redirectUrl;
    }
  }, [redirectUrl]);

  const createCheckoutSession = useMutation(
    trpc.account.createCheckoutSession.mutationOptions({
      onSuccess: (data) => {
        if (data.checkoutUrl) {
          toast.success('Redirecting to checkout...', {
            autoClose: 1000,
            closeButton: true,
            icon: () =>
              React.createElement(CreditCard, { className: 'h-4 w-4' }),
          });
          setRedirectUrl(data.checkoutUrl);
        } else {
          toast.error('Failed to create checkout session');
        }
      },
      onError: handleError,
    }),
  );

  const createDashboardSession = useMutation(
    trpc.account.createDashboardSession.mutationOptions({
      onSuccess: (data) => {
        toast.success('Redirecting to Stripe dashboard...', {
          autoClose: 1000,
          closeButton: true,
          icon: () => React.createElement(CreditCard, { className: 'h-4 w-4' }),
        });
        setRedirectUrl(data.billingPortalUrl);
      },
      onError: handleError,
    }),
  );

  return {
    setRedirectUrl,
    checkout: (productId: string) =>
      createCheckoutSession.mutate({ productId }),
    openBillingPortal: () => createDashboardSession.mutate(),
    createCheckoutSession,
    createDashboardSession,
    isPending:
      createCheckoutSession.isPending || createDashboardSession.isPending,
  };
}
