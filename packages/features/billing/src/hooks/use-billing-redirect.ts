'use client';

import React from 'react';
import { useMutation } from '@tanstack/react-query';
import { TRPCClientError } from '@trpc/client';
import { CreditCard } from 'lucide-react';
import { toast } from 'react-toastify';

import { useGenericErrorHandler } from '@acme/hooks';

import { useTRPC } from '../trpc/react';
import { BillingErrorCode, toBillingErrorCode } from '../utils/stripe-errors';

// The redirect toast shown while the browser is being sent to Stripe. Shared by
// the Checkout and Billing-portal flows so the icon/timing never drift apart.
const REDIRECT_TOAST_OPTS = {
  autoClose: 1000,
  closeButton: true,
  icon: () => React.createElement(CreditCard, { className: 'h-4 w-4' }),
};

const ERROR_TOAST_OPTS = { autoClose: 4000, closeButton: true } as const;

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

// The billing-portal redirect copy. No call site overrides it, so it stays a
// module constant rather than a caller-tunable knob.
const BILLING_PORTAL_MESSAGE = 'Redirecting to Stripe dashboard...';

// The redirect labels callers may override. Only the checkout copy is tuned
// (the admin panel shows "Redirecting to Stripe checkout...").
export interface BillingRedirectMessages {
  checkout?: string;
}

/**
 * The Billing redirect module (billing CONTEXT.md): the single home for the
 * create-session → redirect-URL → navigate flow. It owns both create-session
 * mutations (Checkout session and Billing portal), the loading toast, the typed
 * billing-error → toast mapping (reusing the `BillingErrorCode` seam), and ONE
 * navigation mechanism — so the flow is a single edit instead of three copies.
 *
 * Navigation is via `globalThis.location.href` in a single effect (runtime-
 * agnostic, never next/navigation), replacing the divergent `.assign` copy the
 * admin panel used.
 *
 * Callers compose this and layer their own routing on top; the redirect labels
 * can be overridden where a call site shows different copy.
 */
export function useBillingRedirect(messages: BillingRedirectMessages = {}) {
  const { checkout: checkoutMessage = 'Redirecting to checkout...' } = messages;

  const trpc = useTRPC();
  const handleGenericError = useGenericErrorHandler();

  const [redirectUrl, setRedirectUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (redirectUrl) {
      globalThis.location.href = redirectUrl;
    }
  }, [redirectUrl]);

  // Branch on the TYPED billing error code carried in the tRPC error message
  // (stripe-errors.ts) — no substring matching, so rewording a server message
  // can't silently break a UI branch — falling back to the generic handler.
  const handleBillingError = (error: unknown) => {
    if (error instanceof TRPCClientError) {
      const code = toBillingErrorCode(error);
      if (code) {
        toast.error(BILLING_ERROR_TOASTS[code], ERROR_TOAST_OPTS);
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
        if (data.checkoutUrl) {
          toast.success(checkoutMessage, REDIRECT_TOAST_OPTS);
          setRedirectUrl(data.checkoutUrl);
        } else {
          toast.error('Failed to create checkout session');
        }
      },
      onError: handleBillingError,
    }),
  );

  const createDashboardSession = useMutation(
    trpc.account.createDashboardSession.mutationOptions({
      onSuccess: (data) => {
        toast.success(BILLING_PORTAL_MESSAGE, REDIRECT_TOAST_OPTS);
        setRedirectUrl(data.billingPortalUrl);
      },
      onError: handleBillingError,
    }),
  );

  return {
    checkout: (productId: string) =>
      createCheckoutSession.mutate({ productId }),
    openBillingPortal: () => createDashboardSession.mutate(),
    handleBillingError,
    isPending:
      createCheckoutSession.isPending || createDashboardSession.isPending,
  };
}
