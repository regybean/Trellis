'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'react-toastify';

import { useAuth } from '@acme/auth';

import type { PricingPlan } from '../data/pricing-data';
import type { ButtonState } from '../lib/plan-selection';
import { toPlanIds } from '../config';
import { useBillingConfig } from '../config-context';
import { buildPricingPlans } from '../data/pricing-data';
import { getButtonState } from '../lib/plan-selection';
import { useTRPC } from '../trpc/react';
import { useBillingRedirect } from './use-billing-redirect';

export interface PricingCard {
  plan: PricingPlan;
  buttonState: ButtonState;
  isProcessing: boolean;
}

/**
 * Deep module for the pricing page: reads the viewer's Subscription, derives
 * each plan's CTA state (via the pure plan-selection tree), and drives plan
 * selection — routing new customers to Checkout and existing ones to the
 * Billing portal.
 *
 * The create-session → redirect-URL → navigate flow (plus its loading toast and
 * typed billing-error → toast mapping) lives in the Billing redirect module
 * (use-billing-redirect.ts); this hook composes it and layers only its own
 * routing on top — the signed-out → `/sign-in` hop, the localstripe-CTA gate
 * (reading the config mode, never NODE_ENV), and the per-plan `isProcessing` UI
 * state. So the pricing page and the standalone checkout path can never drift.
 *
 * Keeps `PricingPage` UI-only (see CLAUDE.md). Runtime-agnostic: navigates via
 * `globalThis.location`, not next/navigation.
 */
export function usePricing() {
  const trpc = useTRPC();
  const { isSignedIn, isLoaded } = useAuth();
  const config = useBillingConfig();
  // localstripe has no Checkout Sessions API — the pricing CTAs can't create a
  // checkout. Tiers are granted from the admin page (account.setUserTier)
  // instead. Read the server-derived mode from config, never NODE_ENV (a real-
  // Stripe dev build must classify correctly). See docs/adr/0003.
  const { localstripeMode } = config;
  const planIds = toPlanIds(config);
  const pricingPlans = buildPricingPlans(planIds);

  const subscription = useQuery(
    trpc.account.getSubscriptionDetails.queryOptions(undefined, {
      enabled: isLoaded && isSignedIn,
    }),
  );

  const redirect = useBillingRedirect();
  const [processingPlanId, setProcessingPlanId] = React.useState<string | null>(
    null,
  );

  const selectPlan = (plan: PricingPlan) => {
    if (!isLoaded) return;

    if (!isSignedIn) {
      globalThis.location.href = '/sign-in';
      return;
    }

    // localstripe has no Checkout/billing-portal API, so the CTAs can't work in
    // dev — grant tiers from the admin page instead.
    if (localstripeMode) {
      toast.info('Checkout is unavailable in dev — set tiers from /admin.');
      return;
    }

    const currentSubscription = subscription.data?.subscription ?? 'Basic';

    setProcessingPlanId(plan.id);

    if (currentSubscription === 'Basic') {
      redirect.checkout(plan.id);
    } else {
      // Existing paid Subscription — all changes go through the Billing portal.
      redirect.openBillingPortal();
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
    // The clicked plan shows its processing UI while the shared redirect's
    // create-session mutation is in flight; it clears when the mutation settles
    // (success navigates away, error re-enables the CTA).
    isProcessing: redirect.isPending && processingPlanId === plan.id,
  }));

  return { cards, selectPlan, localstripeMode, planIds };
}
