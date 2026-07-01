import { z } from 'zod/v4';

import type { Telemetry } from '@acme/telemetry/server';
import { logger } from '@acme/logger';
import { redis } from '@acme/redis';
import {
  stripeCustomerKey,
  SubscriptionCacheSchema,
} from '@acme/subscriptions';

import type { STRIPE_SUB_CACHE } from './stripe-client';
import { env } from '../env';
import { getStripe } from './stripe-client';
import { buildSubscriptionCache } from './subscription-cache';

/**
 * Read the customer's current subscription from Stripe and mirror it into the
 * Redis KV cache. The single source of truth the app reads from; called by the
 * webhook processor, the checkout success handler, and dev tooling.
 */
export async function syncStripeDataToKV(
  customerId: string,
  telemetry?: Telemetry,
): Promise<STRIPE_SUB_CACHE> {
  const operation = async () => {
    const stripe = getStripe();
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      limit: 1,
      status: 'all',
      // localstripe has no `price` on items and no `default_payment_method` on
      // subscriptions, and 400s on expand paths it can't resolve. Skip expands
      // there; buildSubscriptionCache reads the inline `plan` fallback instead.
      expand: env.STRIPE_API_BASE
        ? []
        : ['data.default_payment_method', 'data.items.data.price'],
    });

    if (subscriptions.data.length === 0 || !subscriptions.data[0]) {
      const none = { status: 'none' } as const;
      await redis.set(stripeCustomerKey(customerId), JSON.stringify(none));
      telemetry?.set({
        'stripe.sync.result': 'no_subscription',
        'stripe.sync.customer_id': customerId,
      });
      return none;
    }

    const subscription = subscriptions.data[0];
    const candidate = buildSubscriptionCache(subscription);

    const validated = SubscriptionCacheSchema.safeParse(candidate);
    const subData: STRIPE_SUB_CACHE = validated.success
      ? validated.data
      : { status: 'none' };

    if (validated.success) {
      telemetry?.set({
        'stripe.sync.result': 'success',
        'stripe.sync.customer_id': customerId,
        'stripe.sync.subscription_status': subData.status,
      });
    } else {
      logger.warn(
        {
          customerId,
          validationError: z.treeifyError(validated.error),
        },
        'Validation failed for subscription cache',
      );
      telemetry?.set({
        'stripe.sync.validation_failed': true,
        'stripe.sync.customer_id': customerId,
      });
    }

    await redis.set(stripeCustomerKey(customerId), JSON.stringify(subData));

    return subData;
  };

  if (telemetry) {
    return await telemetry.withSpan('stripe.syncStripeDataToKV', operation, {
      attributes: { 'stripe.operation': 'subscriptions.list' },
    });
  }
  return await operation();
}
