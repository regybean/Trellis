import { describe, expect, it } from 'vitest';

import type {
  SubscriptionCache,
  SubscriptionTier,
} from '../../subscription-cache';
import { billingWindow, creditLimitFor } from '../../credit-policy';

/**
 * Domain (pure) tests for the Credit policy. No Redis, no mocks — just the
 * numbers and dates. The Redis-backed operations that read this policy are
 * covered against a real Redis in `tests/service/credits.test.ts`.
 */

describe('creditLimitFor', () => {
  it.each([
    ['Basic', 250],
    ['Standard', 350],
    ['Pro', 1600],
  ] as const)('returns the %s limit of %i', (tier, limit) => {
    expect(creditLimitFor(tier)).toBe(limit);
  });

  it('falls back to the default limit for an unknown tier', () => {
    expect(creditLimitFor('Mystery' as SubscriptionTier)).toBe(250);
  });
});

describe('billingWindow', () => {
  it('uses the Stripe period for an active subscription', () => {
    const currentPeriodStart = 1_700_000_000;
    const currentPeriodEnd = 1_702_592_000;
    const subscription: SubscriptionCache = {
      status: 'active',
      subscriptionId: 'sub_1',
      product: 'prod_1',
      priceId: 'price_1',
      currentPeriodStart,
      currentPeriodEnd,
      cancelAtPeriodEnd: false,
      paymentMethod: null,
    };

    expect(billingWindow(subscription)).toEqual({
      start: currentPeriodStart,
      end: currentPeriodEnd,
    });
  });

  it('falls back to the current calendar month when there is no subscription', () => {
    const { start, end } = billingWindow({ status: 'none' });

    const now = new Date();
    const expectedStart = Math.floor(
      new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000,
    );
    const expectedEnd = Math.floor(
      new Date(
        now.getFullYear(),
        now.getMonth() + 1,
        0,
        23,
        59,
        59,
        999,
      ).getTime() / 1000,
    );

    expect(start).toBe(expectedStart);
    expect(end).toBe(expectedEnd);
    expect(end).toBeGreaterThan(start);
  });

  it('falls back to the month when an active subscription lacks a period', () => {
    const subscription = {
      status: 'active',
      subscriptionId: 'sub_1',
      product: 'prod_1',
      priceId: 'price_1',
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      paymentMethod: null,
    } satisfies SubscriptionCache;

    const { start, end } = billingWindow(subscription);
    expect(end).toBeGreaterThan(start);
  });
});
