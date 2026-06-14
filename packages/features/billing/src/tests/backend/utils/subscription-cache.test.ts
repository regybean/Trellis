/**
 * buildSubscriptionCache unit tests
 *
 * Focus: the price/plan compatibility shim. Real Stripe returns the modern
 * `price` on subscription items; localstripe returns the legacy `plan` and
 * omits `price`. Both must map onto the same cache shape.
 */

import type { Stripe } from 'stripe';
import { describe, expect, it } from 'vitest';

import { buildSubscriptionCache } from '../../../utils/subscription-cache';

interface ItemShape {
  price?: { id: string; product: string | { id: string } };
  plan?: { id: string; product: string | { id: string } };
  current_period_start?: number;
  current_period_end?: number;
}

function makeSubscription(
  item: ItemShape | undefined,
  overrides: Partial<Stripe.Subscription> = {},
): Stripe.Subscription {
  const sub = {
    id: 'sub_123',
    status: 'active',
    cancel_at_period_end: false,
    default_payment_method: null,
    items: { data: item ? [item] : [] },
    ...overrides,
  };
  // Stripe.Subscription is a large SDK type; this fixture provides only the
  // fields buildSubscriptionCache reads.
  return sub as unknown as Stripe.Subscription;
}

describe('buildSubscriptionCache', () => {
  it('reads product/priceId from the modern `price` (real Stripe)', () => {
    const result = buildSubscriptionCache(
      makeSubscription({
        price: { id: 'price_abc', product: 'prod_standard' },
        current_period_start: 100,
        current_period_end: 200,
      }),
    );

    expect(result).toMatchObject({
      subscriptionId: 'sub_123',
      status: 'active',
      product: 'prod_standard',
      priceId: 'price_abc',
      currentPeriodStart: 100,
      currentPeriodEnd: 200,
    });
  });

  it('falls back to the legacy `plan` when `price` is absent (localstripe)', () => {
    const result = buildSubscriptionCache(
      makeSubscription({
        plan: { id: 'price_dev_standard', product: 'prod_dev_standard' },
        current_period_start: 100,
        current_period_end: 200,
      }),
    );

    expect(result).toMatchObject({
      product: 'prod_dev_standard',
      priceId: 'price_dev_standard',
    });
  });

  it('prefers `price` over `plan` when both are present', () => {
    const result = buildSubscriptionCache(
      makeSubscription({
        price: { id: 'price_modern', product: 'prod_modern' },
        plan: { id: 'price_legacy', product: 'prod_legacy' },
      }),
    );

    expect(result.product).toBe('prod_modern');
    expect(result.priceId).toBe('price_modern');
  });

  it('nulls product when it is an expanded object rather than an id', () => {
    const result = buildSubscriptionCache(
      makeSubscription({
        price: { id: 'price_abc', product: { id: 'prod_standard' } },
      }),
    );

    expect(result.product).toBeNull();
    expect(result.priceId).toBe('price_abc');
  });

  it('maps the default payment method card details', () => {
    const result = buildSubscriptionCache(
      makeSubscription(
        { price: { id: 'price_abc', product: 'prod_standard' } },
        {
          default_payment_method: {
            card: { brand: 'visa', last4: '4242' },
          } as unknown as Stripe.PaymentMethod,
        },
      ),
    );

    expect(result.paymentMethod).toEqual({ brand: 'visa', last4: '4242' });
  });

  it('handles a subscription with no items', () => {
    const result = buildSubscriptionCache(makeSubscription(undefined));

    expect(result).toMatchObject({
      product: null,
      priceId: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      paymentMethod: null,
    });
  });
});
