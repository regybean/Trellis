/**
 * `syncStripeDataToKV` against localstripe — the legacy Plans fallback, proven
 * rather than assumed.
 *
 * ../../../../../docs/adr/0001-localstripe-dev-billing.md decision 3 rests on a
 * claim about a server we don't control: localstripe predates Stripe's Prices
 * API, so subscription items carry `plan` and omit `price` entirely, which is
 * why `buildSubscriptionCache` reads `price ?? plan` and `syncStripeDataToKV`
 * skips the `data.items.data.price` expand. The sibling `stripe-sync.test.ts`
 * covers the same fallback over a hand-written fake — useful for the shapes
 * real Stripe returns, but it can only confirm what we already believed about
 * localstripe.
 *
 * So this file asserts the premise first (the item really does arrive with
 * `plan` and no `price`) and the consequence second (the cache still lands the
 * right price and product). If localstripe ever grows the Prices API, the first
 * assertion fails and the fallback can go — rather than the fallback quietly
 * becoming dead code nothing notices.
 *
 * `@acme/subscriptions` is real (setup.ts mocks only its `credits` façade), so
 * the assertions read the cache back through the same public API the app uses,
 * against the suite's isolated Redis DB, rather than spying on
 * `setSubscriptionCache`.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { flushTestDb } from '@acme/redis/testing';
import {
  getStripeCustomerId,
  getSubscriptionType,
  getUserSubscriptionFromRedis,
  setStripeCustomerId,
} from '@acme/subscriptions';

import { getStripe } from '../../../../api/services/stripe-client';
import { syncStripeDataToKV } from '../../../../api/services/stripe-sync';
import { env, toPlanIds } from '../../../../env';
import { seedLocalstripePlans } from '../../../../testing';
import { createTestUserId } from '../../utils/fixtures';

const planIds = toPlanIds(env);

beforeAll(async () => {
  await seedLocalstripePlans(getStripe(), planIds);
});

beforeEach(async () => {
  await flushTestDb();
});

/**
 * Put a real active subscription in localstripe for a fresh user, the way the
 * dev grant does: attach the built-in test card as the customer's default so
 * the first invoice is paid, then subscribe on the tier's seeded plan.
 *
 * Deliberately the SDK rather than `setUserTier`, so the subject of this file
 * stays the sync and its cache mapper.
 */
async function subscribeOnSeededPlan(productId: string) {
  const stripe = getStripe();
  const userId = createTestUserId();

  const customer = await stripe.customers.create({
    email: 'sync@example.com',
    metadata: { userId },
  });
  await setStripeCustomerId(userId, customer.id);

  const pm = await stripe.paymentMethods.attach('pm_card_visa', {
    customer: customer.id,
  });
  await stripe.customers.update(customer.id, {
    invoice_settings: { default_payment_method: pm.id },
  });

  const plans = await stripe.plans.list({ product: productId, limit: 1 });
  const planId = plans.data[0]?.id;
  expect(planId).toBeDefined();

  await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ plan: String(planId) }],
  });

  return { userId, customerId: customer.id, planId: String(planId) };
}

describe('syncStripeDataToKV against localstripe', () => {
  it('receives a subscription item carrying `plan` and no `price`', async () => {
    const { customerId, planId } = await subscribeOnSeededPlan(
      planIds.standardPlanId,
    );

    // The same list call the service makes, with the same localstripe-mode
    // expands — so what is inspected is what `buildSubscriptionCache` is handed.
    const subscriptions = await getStripe().subscriptions.list({
      customer: customerId,
      status: 'all',
      limit: 100,
    });
    const item = subscriptions.data[0]?.items.data[0];

    expect(item).toBeDefined();
    expect(item?.price).toBeUndefined();
    expect(item?.plan).toMatchObject({
      id: planId,
      product: planIds.standardPlanId,
    });
  });

  it('caches the plan id as the price id, and the plan product as the product', async () => {
    const { userId, customerId, planId } = await subscribeOnSeededPlan(
      planIds.standardPlanId,
    );

    await syncStripeDataToKV(customerId);

    // `priceId` comes off `plan.id` through the `price?.id ?? plan?.id` read,
    // and `product` off `plan.product` through `price?.product ?? plan?.product`.
    expect(await getUserSubscriptionFromRedis(userId)).toMatchObject({
      status: 'active',
      priceId: planId,
      product: planIds.standardPlanId,
    });
  });

  // The product is what the fallback exists to deliver: `getSubscriptionType`
  // compares it against the env plan ids, so losing it to the missing `price`
  // would silently downgrade every paid user to Basic.
  it('resolves the tier the plan product maps to', async () => {
    const { userId, customerId } = await subscribeOnSeededPlan(
      planIds.proPlanId,
    );

    await syncStripeDataToKV(customerId);

    expect(
      getSubscriptionType(await getUserSubscriptionFromRedis(userId), planIds),
    ).toBe('Pro');
    expect(await getStripeCustomerId(userId)).toBe(customerId);
  });
});
