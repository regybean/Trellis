'use client';

import React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { TRPCClientError } from '@trpc/client';
import { CreditCard } from 'lucide-react';
import { toast } from 'react-toastify';

import { useGenericErrorHandler } from '@acme/hooks';
import { logger } from '@acme/logger';

import { useTRPC } from '../trpc/react';
import { BillingErrorCode, toBillingErrorCode } from '../utils/stripe-errors';

const TOAST_OPTS = { autoClose: 4000, closeButton: true } as const;

// Map each typed billing error code to its user-facing toast. Exhaustive over
// BillingErrorCode via Record, so adding a code is a compile error until it's
// handled here — the coupling is typed, not string-matched against prose.
const BILLING_ERROR_TOASTS: Record<BillingErrorCode, string> = {
  [BillingErrorCode.NoDefaultPrice]:
    '❌ Product configuration error: Missing default price',
  [BillingErrorCode.ActiveSubscription]:
    '⚠️ You already have an active subscription',
  [BillingErrorCode.CustomerManagementFailed]:
    '❌ Customer account error: Please try again',
  [BillingErrorCode.NoEmail]:
    '❌ Account setup required: Please add an email address',
  [BillingErrorCode.NoCustomer]: '❌ No existing Stripe customer found',
  [BillingErrorCode.StripeUnavailable]:
    '❌ Stripe service error: Please try again later',
  [BillingErrorCode.DevOnly]: '❌ This action is only available in local dev',
  [BillingErrorCode.MissingPlan]:
    '❌ Billing plan not configured: run the localstripe seed',
};

/**
 * Admin Stripe test panel: create a demo Checkout session and exercise the
 * tier-gated test procedures, branching on the TYPED billing error code carried
 * in the tRPC error message (see stripe-errors.ts) — no substring matching, so
 * rewording a server message can't silently break a UI branch. Keeps
 * `StripeTesting` UI-only.
 */
export function useStripeTesting() {
  const trpc = useTRPC();
  const handleGenericError = useGenericErrorHandler();

  const handleStripeError = (error: unknown) => {
    if (error instanceof TRPCClientError) {
      const code = toBillingErrorCode(error);
      if (code) {
        toast.error(BILLING_ERROR_TOASTS[code], TOAST_OPTS);
        return;
      }
      handleGenericError(error);
      return;
    }
    handleGenericError();
  };

  const createCheckoutSession = useMutation(
    trpc.account.createCheckoutSession.mutationOptions({
      onSuccess: (data) => {
        logger.debug({ data }, 'checkout session created');
        if (data.checkoutUrl) {
          toast.success('Redirecting to Stripe checkout...', {
            autoClose: 1000,
            closeButton: true,
            icon: () =>
              React.createElement(CreditCard, { className: 'h-4 w-4' }),
          });
          globalThis.location.assign(data.checkoutUrl);
        } else {
          toast.error('Failed to create checkout session');
        }
      },
      onError: handleStripeError,
    }),
  );

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
      handleStripeError(error);
    } else if (data) {
      toast.success(data.message, { autoClose: 2500 });
    }
  };

  return {
    testCheckout: (productId: string) =>
      createCheckoutSession.mutate({ productId }),
    isCreatingCheckout: createCheckoutSession.isPending,
    runFeatureTest,
  };
}
