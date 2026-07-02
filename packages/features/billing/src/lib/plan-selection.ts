// Pure plan-selection decision tree. Given a plan, the viewer's auth state and
// their current Subscription, decide what the CTA button should say and whether
// it is actionable. No React, no tRPC — trivially unit-testable.
//
// Moved out of `data/pricing-data.ts` (pure data only) into the hooks layer:
// this is business logic (the Tier hierarchy: Basic < Standard < Pro), not data.

import type { PricingPlan } from '../data/pricing-data';

export type ButtonVariant =
  | 'loading'
  | 'signin'
  | 'selected'
  | 'purchase'
  | 'upgrade'
  | 'downgrade'
  | 'default';

export interface ButtonState {
  text: string;
  disabled: boolean;
  variant: ButtonVariant;
}

const PLAN_HIERARCHY: Record<string, number> = {
  Basic: 0,
  Standard: 1,
  Pro: 2,
  Enterprise: 3,
};

const planLevel = (planName: string): number => PLAN_HIERARCHY[planName] ?? 0;

const planChangeType = (
  currentPlan: string,
  targetPlan: string,
): 'upgrade' | 'downgrade' | 'same' => {
  const current = planLevel(currentPlan);
  const target = planLevel(targetPlan);
  if (target > current) return 'upgrade';
  if (target < current) return 'downgrade';
  return 'same';
};

// Authenticated viewer with a known current plan: decide the CTA relative to
// their Subscription. Split out of getButtonState so each stays within the
// cognitive-complexity budget.
const getSubscribedButtonState = (
  plan: PricingPlan,
  current: string,
): ButtonState => {
  if (plan.name === current) {
    return { text: 'Current Plan', disabled: true, variant: 'selected' };
  }
  if (current !== 'Basic' && plan.id === 'basic') {
    return { text: 'Downgrade to Basic', disabled: true, variant: 'downgrade' };
  }

  const isPaidPlan = plan.monthlyPrice !== null && plan.monthlyPrice > 0;
  if (current === 'Basic' && isPaidPlan) {
    return {
      text: `Choose ${plan.name}`,
      disabled: false,
      variant: 'purchase',
    };
  }
  if (current !== 'Basic' && isPaidPlan) {
    const changeType = planChangeType(current, plan.name);
    if (changeType === 'upgrade') {
      return {
        text: `Upgrade to ${plan.name}`,
        disabled: false,
        variant: 'upgrade',
      };
    }
    if (changeType === 'downgrade') {
      return {
        text: `Downgrade to ${plan.name}`,
        disabled: false,
        variant: 'downgrade',
      };
    }
  }
  return { text: plan.cta, disabled: false, variant: 'default' };
};

export const getButtonState = (
  plan: PricingPlan,
  currentSubscription: string | undefined = 'Basic',
  isSubscriptionLoading = false,
  isAuthenticated = true,
  isAuthLoaded = true,
): ButtonState => {
  if (!isAuthLoaded) {
    return { text: 'Loading...', disabled: true, variant: 'loading' };
  }
  if (!isAuthenticated) {
    return {
      text: plan.id === 'basic' ? 'Login to Start' : `Choose ${plan.name}`,
      disabled: false,
      variant: 'signin',
    };
  }
  if (isSubscriptionLoading) {
    return { text: 'Loading...', disabled: true, variant: 'loading' };
  }
  return getSubscribedButtonState(plan, currentSubscription);
};
