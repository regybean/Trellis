import { beforeEach, describe, expect, it, vi } from 'vitest';

import { flushTestDb } from '@acme/redis/testing';
import {
  getUserSubscriptionFromRedis,
  setStripeCustomerId,
} from '@acme/subscriptions';

import { getStripe } from '../../../../api/services/stripe-client';
import { syncStripeDataToKV } from '../../../../api/services/stripe-sync';

// `@acme/subscriptions` is real here (setup.ts mocks only its `credits`
// façade), so the service contract — "subscription data lands in Redis" — is
// asserted by reading back through the same public API the rest of the app
// uses, not with a spy on setSubscriptionCache.

// Behavioral fake for the Stripe SDK: each test supplies the subscription
// shape. localstripe cannot serve the *real* Stripe `price` shape (it predates
// the Prices API), so the shapes both servers return are covered over a fake
// here; the localstripe half is then pinned against the container itself in
// ./stripe-sync-localstripe.test.ts.
vi.mock('../../../../api/services/stripe-client');

const CUSTOMER_ID = 'cus_sync_test';
const USER_ID = 'user_sync_test';

// The pair a tier change leaves behind: the grant cancels the predecessor, then
// creates the replacement.
const CANCELED_PREDECESSOR = {
  id: 'sub_canceled',
  status: 'canceled',
  created: 1000,
  cancel_at_period_end: false,
  default_payment_method: null,
  items: {
    data: [
      {
        price: { id: 'price_std', product: 'prod_std' },
        current_period_start: 1000,
        current_period_end: 2000,
      },
    ],
  },
};

const ACTIVE_REPLACEMENT = {
  id: 'sub_active',
  status: 'active',
  created: 2000,
  cancel_at_period_end: false,
  default_payment_method: null,
  items: {
    data: [
      {
        price: { id: 'price_pro', product: 'prod_pro' },
        current_period_start: 2000,
        current_period_end: 3000,
      },
    ],
  },
};

function makeStripeFake(subscriptions: unknown[]) {
  return {
    subscriptions: { list: vi.fn().mockResolvedValue({ data: subscriptions }) },
  } as unknown as ReturnType<typeof getStripe>;
}

beforeEach(async () => {
  await flushTestDb();
  await setStripeCustomerId(USER_ID, CUSTOMER_ID);
});

describe('syncStripeDataToKV', () => {
  it('writes modern price shape to Redis', async () => {
    vi.mocked(getStripe).mockReturnValue(
      makeStripeFake([
        {
          id: 'sub_modern',
          status: 'active',
          cancel_at_period_end: false,
          default_payment_method: null,
          items: {
            data: [
              {
                price: { id: 'price_std', product: 'prod_std' },
                current_period_start: 1000,
                current_period_end: 2000,
              },
            ],
          },
        },
      ]),
    );

    await syncStripeDataToKV(CUSTOMER_ID);

    const stored = await getUserSubscriptionFromRedis(USER_ID);
    expect(stored).toMatchObject({
      status: 'active',
      subscriptionId: 'sub_modern',
      priceId: 'price_std',
      product: 'prod_std',
      currentPeriodStart: 1000,
      currentPeriodEnd: 2000,
    });
  });

  it('writes legacy plan shape to Redis (localstripe compat)', async () => {
    vi.mocked(getStripe).mockReturnValue(
      makeStripeFake([
        {
          id: 'sub_legacy',
          status: 'active',
          cancel_at_period_end: false,
          default_payment_method: null,
          items: {
            data: [
              {
                plan: { id: 'price_dev', product: 'prod_dev' },
                current_period_start: 3000,
                current_period_end: 4000,
              },
            ],
          },
        },
      ]),
    );

    await syncStripeDataToKV(CUSTOMER_ID);

    const stored = await getUserSubscriptionFromRedis(USER_ID);
    expect(stored).toMatchObject({
      status: 'active',
      subscriptionId: 'sub_legacy',
      priceId: 'price_dev',
      product: 'prod_dev',
    });
  });

  // A customer mid-tier-change holds two subscriptions, and the list order they
  // arrive in differs by server (real Stripe newest-first, localstripe
  // oldest-first). Both orders must cache the active one — this is the seam
  // where the ordering assumption used to live, so it is asserted here and not
  // only over the pure ranking function.
  it.each([
    [
      'oldest-first, as localstripe lists',
      [CANCELED_PREDECESSOR, ACTIVE_REPLACEMENT],
    ],
    [
      'newest-first, as real Stripe lists',
      [ACTIVE_REPLACEMENT, CANCELED_PREDECESSOR],
    ],
  ])(
    'caches the active subscription when listed %s',
    async (_order, subscriptions) => {
      vi.mocked(getStripe).mockReturnValue(makeStripeFake(subscriptions));

      await syncStripeDataToKV(CUSTOMER_ID);

      expect(await getUserSubscriptionFromRedis(USER_ID)).toMatchObject({
        status: 'active',
        subscriptionId: 'sub_active',
        product: 'prod_pro',
      });
    },
  );

  it('writes {status:"none"} when no subscriptions exist', async () => {
    vi.mocked(getStripe).mockReturnValue(makeStripeFake([]));

    await syncStripeDataToKV(CUSTOMER_ID);

    const stored = await getUserSubscriptionFromRedis(USER_ID);
    expect(stored).toEqual({ status: 'none' });
  });

  it('writes {status:"none"} when subscription fails schema validation', async () => {
    vi.mocked(getStripe).mockReturnValue(
      makeStripeFake([
        {
          id: 'sub_invalid',
          // 'draft' is not in SubscriptionCacheSchema's status enum →
          // validation fails → syncStripeDataToKV falls back to {status:'none'}
          status: 'draft',
          cancel_at_period_end: false,
          default_payment_method: null,
          items: {
            data: [
              {
                price: { id: 'price_x', product: 'prod_x' },
                current_period_start: 100,
                current_period_end: 200,
              },
            ],
          },
        },
      ]),
    );

    await syncStripeDataToKV(CUSTOMER_ID);

    const stored = await getUserSubscriptionFromRedis(USER_ID);
    expect(stored).toEqual({ status: 'none' });
  });
});
