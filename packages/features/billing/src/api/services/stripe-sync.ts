import { z } from 'zod/v4';

import { logger } from '@acme/logger';
import {
  setSubscriptionCache,
  SubscriptionCacheSchema,
} from '@acme/subscriptions';
import { setSpanAttributes, withSpan } from '@acme/telemetry/server';

import type { STRIPE_SUB_CACHE } from './stripe-client';
import { getStripe, localstripeMode } from './stripe-client';
import { buildSubscriptionCache } from './subscription-cache';
import { selectCurrentSubscription } from './subscription-selection';

/**
 * Read the customer's current subscription from Stripe and mirror it into the
 * Redis KV cache. The single source of truth the app reads from; called by the
 * webhook processor, the checkout success handler, and dev tooling.
 */
export async function syncStripeDataToKV(
  customerId: string,
): Promise<STRIPE_SUB_CACHE> {
  return await withSpan(
    'stripe.syncStripeDataToKV',
    async () => {
      const stripe = getStripe();
      // Every subscription, not the first one: a customer can hold several
      // (a tier change cancels the predecessor before creating the
      // replacement), and which of them is "current" is a decision
      // `selectCurrentSubscription` makes on status and recency rather than
      // one the two servers' list ordering makes for us. 100 is Stripe's page
      // maximum; a customer with more than that has a data problem, not a
      // pagination one.
      const subscriptions = await stripe.subscriptions.list({
        customer: customerId,
        limit: 100,
        status: 'all',
        // localstripe has no `price` on items and no `default_payment_method` on
        // subscriptions, and 400s on expand paths it can't resolve. Skip expands
        // there; buildSubscriptionCache reads the inline `plan` fallback instead.
        expand: localstripeMode
          ? []
          : ['data.default_payment_method', 'data.items.data.price'],
      });

      const subscription = selectCurrentSubscription(subscriptions.data);

      if (!subscription) {
        const none = { status: 'none' } as const;
        await setSubscriptionCache(customerId, none);
        setSpanAttributes({
          'stripe.sync.result': 'no_subscription',
          'stripe.sync.customer_id': customerId,
        });
        return none;
      }

      const candidate = buildSubscriptionCache(subscription);

      const validated = SubscriptionCacheSchema.safeParse(candidate);
      const subData: STRIPE_SUB_CACHE = validated.success
        ? validated.data
        : { status: 'none' };

      if (validated.success) {
        setSpanAttributes({
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
        setSpanAttributes({
          'stripe.sync.validation_failed': true,
          'stripe.sync.customer_id': customerId,
        });
      }

      await setSubscriptionCache(customerId, subData);

      return subData;
    },
    { attributes: { 'stripe.operation': 'subscriptions.list' } },
  );
}
