import { beforeEach, describe, expect, it, vi } from 'vitest';

import { flushTestDb } from '@acme/redis/testing';
import {
  getUserSubscriptionFromRedis,
  setStripeCustomerId,
} from '@acme/subscriptions';

import { getStripe } from '../../../../utils/stripe-client';
import { syncStripeDataToKV } from '../../../../utils/stripe-sync';

// Use the real @acme/subscriptions module (real Redis writes), overriding the
// global mock that setup.ts installs for the API suite. The service contract is
// "subscription data lands in Redis" — assertion reads back through the same
// public API the rest of the app uses, not a spy on setSubscriptionCache.
vi.mock('@acme/subscriptions', async () =>
  vi.importActual('@acme/subscriptions'),
);

// Behavioral fake for the Stripe SDK: each test supplies the subscription shape.
vi.mock('../../../../utils/stripe-client');

const CUSTOMER_ID = 'cus_sync_test';
const USER_ID = 'user_sync_test';

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
