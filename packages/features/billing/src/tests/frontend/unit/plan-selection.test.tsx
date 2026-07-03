import { describe, expect, it } from 'vitest';

import type { PricingPlan } from '../../../data/pricing-data';
import { getButtonState } from '../../../lib/plan-selection';

const plan = (over: Partial<PricingPlan> = {}): PricingPlan => ({
  id: 'standard_plan_12345',
  name: 'Standard',
  description: '',
  monthlyPrice: 30,
  credits: 350,
  highlight: false,
  popular: false,
  cta: 'Choose Standard',
  features: [],
  ...over,
});

const basic = plan({ id: 'basic', name: 'Basic', monthlyPrice: 0 });
const standard = plan();
const pro = plan({ id: 'pro_plan_12345', name: 'Pro', monthlyPrice: 80 });

describe('getButtonState', () => {
  it('shows a loading state until auth has loaded', () => {
    expect(getButtonState(standard, 'Basic', false, false, false)).toEqual({
      text: 'Loading...',
      disabled: true,
      variant: 'loading',
    });
  });

  it('prompts sign-in when unauthenticated', () => {
    expect(getButtonState(basic, 'Basic', false, false, true)).toMatchObject({
      text: 'Login to Start',
      variant: 'signin',
    });
    expect(getButtonState(pro, 'Basic', false, false, true)).toMatchObject({
      text: 'Choose Pro',
      variant: 'signin',
    });
  });

  it('shows a loading state while the subscription query is pending', () => {
    expect(getButtonState(standard, 'Basic', true, true, true)).toEqual({
      text: 'Loading...',
      disabled: true,
      variant: 'loading',
    });
  });

  it('marks the current plan as selected and disabled', () => {
    expect(getButtonState(standard, 'Standard')).toEqual({
      text: 'Current Plan',
      disabled: true,
      variant: 'selected',
    });
  });

  it('disables the Basic card for a paying customer (no self-downgrade to free)', () => {
    expect(getButtonState(basic, 'Standard')).toEqual({
      text: 'Downgrade to Basic',
      disabled: true,
      variant: 'downgrade',
    });
  });

  it('offers purchase for a paid plan when on Basic', () => {
    expect(getButtonState(pro, 'Basic')).toEqual({
      text: 'Choose Pro',
      disabled: false,
      variant: 'purchase',
    });
  });

  it('offers an upgrade when the target tier is higher', () => {
    expect(getButtonState(pro, 'Standard')).toEqual({
      text: 'Upgrade to Pro',
      disabled: false,
      variant: 'upgrade',
    });
  });

  it('offers a downgrade when the target tier is lower', () => {
    expect(getButtonState(standard, 'Pro')).toEqual({
      text: 'Downgrade to Standard',
      disabled: false,
      variant: 'downgrade',
    });
  });

  it('defaults to the plan CTA for the Enterprise (custom-price) card', () => {
    const enterprise = plan({
      id: 'enterprise',
      name: 'Enterprise',
      monthlyPrice: null,
      cta: 'Contact Sales',
    });
    expect(getButtonState(enterprise, 'Standard')).toEqual({
      text: 'Contact Sales',
      disabled: false,
      variant: 'default',
    });
  });
});
