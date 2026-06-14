import type Stripe from 'stripe';

/**
 * Map a Stripe subscription onto our Redis cache shape.
 *
 * Real Stripe returns the modern `price` on each subscription item; localstripe
 * (built on the legacy Plans API) returns `plan` and omits `price` entirely. We
 * prefer `price` and fall back to the deprecated `plan` so the same code path
 * works against both. Real Stripe always populates `price`, so the fallback
 * never fires in production.
 */
export function buildSubscriptionCache(subscription: Stripe.Subscription) {
  const item = subscription.items.data[0];
  const price = item?.price;
  const plan = item?.plan;

  const productRef = price?.product ?? plan?.product;
  const priceId = price?.id ?? plan?.id ?? null;

  return {
    subscriptionId: subscription.id,
    status: subscription.status,
    product: typeof productRef === 'string' ? productRef : null,
    priceId,
    currentPeriodStart: item?.current_period_start ?? null,
    currentPeriodEnd: item?.current_period_end ?? null,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    paymentMethod:
      subscription.default_payment_method &&
      typeof subscription.default_payment_method !== 'string'
        ? {
            brand: subscription.default_payment_method.card?.brand ?? null,
            last4: subscription.default_payment_method.card?.last4 ?? null,
          }
        : null,
  };
}
