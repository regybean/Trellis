'use client';

import React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CreditCard } from 'lucide-react';
import { toast } from 'react-toastify';

import { useAuth } from '@acme/auth';
import { useGenericErrorHandler } from '@acme/hooks';

import type { PricingPlan } from '../data/pricing-data';
import type { ButtonState } from '../lib/plan-selection';
import { pricingPlans } from '../data/pricing-data';
import { env } from '../env';
import { getButtonState } from '../lib/plan-selection';
import { useTRPC } from '../trpc/react';

// In dev we run against localstripe, which has no Checkout Sessions API — the
// pricing CTAs can't create a checkout. Tiers are granted from the admin page
// (account.setUserTier) instead. See docs/adr/0003.
const isDev = env.NODE_ENV === 'development';

export interface PricingCard {
  plan: PricingPlan;
  buttonState: ButtonState;
  isProcessing: boolean;
}

/**
 * Deep module for the pricing page: reads the viewer's Subscription, derives
 * each plan's CTA state (via the pure plan-selection tree), and drives plan
 * selection — routing new customers to Checkout and existing ones to the
 * Billing portal. Keeps `PricingPage` UI-only (see CLAUDE.md).
 *
 * Runtime-agnostic: navigates via `globalThis.location`, not next/navigation.
 */
export function usePricing() {
  const trpc = useTRPC();
  const { isSignedIn, isLoaded } = useAuth();
  const handleError = useGenericErrorHandler();

  const subscription = useQuery(
    trpc.account.getSubscriptionDetails.queryOptions(undefined, {
      enabled: isLoaded && isSignedIn,
    }),
  );

  const [processingPlanId, setProcessingPlanId] = React.useState<string | null>(
    null,
  );
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
      onError: (err) => {
        setProcessingPlanId(null);
        handleError(err);
      },
      onSettled: () => {
        // If redirect didn't happen (e.g. error), clear processing state.
        setTimeout(() => setProcessingPlanId(null), 1500);
      },
    }),
  );

  const createDashboardSession = useMutation(
    trpc.account.createDashboardSession.mutationOptions({
      onSuccess: (data) => {
        toast.success('Redirecting to Stripe dashboard...', {
          autoClose: 1000,
          closeButton: true,
          icon: () =>
            React.createElement(CreditCard, { className: 'h-4 w-4' }),
        });
        setRedirectUrl(data.billingPortalUrl);
      },
      onError: (err) => {
        setProcessingPlanId(null);
        handleError(err);
      },
      onSettled: () => {
        setTimeout(() => setProcessingPlanId(null), 1500);
      },
    }),
  );

  const selectPlan = (plan: PricingPlan) => {
    if (!isLoaded) return;

    if (!isSignedIn) {
      setRedirectUrl('/sign-in');
      return;
    }

    // localstripe has no Checkout/billing-portal API, so the CTAs can't work in
    // dev — grant tiers from the admin page instead.
    if (isDev) {
      toast.info('Checkout is unavailable in dev — set tiers from /admin.');
      return;
    }

    const currentSubscription = subscription.data?.subscription ?? 'Basic';

    setProcessingPlanId(plan.id);

    if (currentSubscription === 'Basic') {
      createCheckoutSession.mutate({ productId: plan.id });
    } else {
      // Existing paid Subscription — all changes go through the Billing portal.
      createDashboardSession.mutate();
    }
  };

  const cards: PricingCard[] = pricingPlans.map((plan) => ({
    plan,
    buttonState: getButtonState(
      plan,
      subscription.data?.subscription,
      subscription.isPending,
      isSignedIn,
      isLoaded,
    ),
    isProcessing: processingPlanId === plan.id,
  }));

  return { cards, selectPlan, isDev };
}
