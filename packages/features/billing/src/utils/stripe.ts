// Stripe Initialization
import { TRPCError } from '@trpc/server';
import Stripe from 'stripe';
import { z } from 'zod/v4';

import type { SubscriptionCache } from '@acme/subscriptions';
import type { Telemetry } from '@acme/telemetry/server';
import { logger } from '@acme/logger';
import { redis } from '@acme/redis';
import { SubscriptionCacheSchema } from '@acme/subscriptions';

import { env } from '../env';

// Constants
const DEFAULT_QUANTITY = 1;
const SUBSCRIPTION_SEARCH_LIMIT = 1;

// Types
interface StripeCustomer {
  id: string;
  email: string | null;
}

export type STRIPE_SUB_CACHE = SubscriptionCache;

// Events I Track - for webhook processing
const allowedEvents = new Set<Stripe.Event.Type>([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  'customer.subscription.pending_update_applied',
  'customer.subscription.pending_update_expired',
  'customer.subscription.trial_will_end',
  'invoice.paid',
  'invoice.payment_failed',
  'invoice.payment_action_required',
  'invoice.upcoming',
  'invoice.marked_uncollectible',
  'invoice.payment_succeeded',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'payment_intent.canceled',
]);

// Lazy initialization to avoid module-time errors in CICD tests
let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    if (!env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY is required');
    }
    _stripe = new Stripe(env.STRIPE_SECRET_KEY, {
      httpClient: Stripe.createFetchHttpClient(),
    });
  }
  return _stripe;
}

export async function getProductWithPrice(
  productId: string,
  telemetry?: Telemetry,
): Promise<{ defaultPriceId: string; productId: string }> {
  const operation = async () => {
    const stripe = getStripe();
    const product = await stripe.products.retrieve(productId);
    const defaultPriceId = product.default_price;

    if (!defaultPriceId || typeof defaultPriceId !== 'string') {
      logger.error({ productId }, 'Product does not have a default price');
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Product does not have a default price',
      });
    }

    telemetry?.set({
      'stripe.product.id': productId,
      'stripe.price.id': defaultPriceId,
    });

    return { defaultPriceId, productId };
  };

  try {
    if (telemetry) {
      return await telemetry.withSpan('stripe.getProductWithPrice', operation, {
        attributes: { 'stripe.operation': 'products.retrieve' },
      });
    }
    return await operation();
  } catch (error) {
    logger.error({ error, productId }, 'Error retrieving product from Stripe');
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Internal Server Error',
    });
  }
}

export async function findOrCreateCustomer(
  email: string,
  userId: string,
  telemetry?: Telemetry,
): Promise<{ customer: StripeCustomer; isExisting: boolean }> {
  const operation = async () => {
    // Get the stripeCustomerId from Redis KV store
    const stripeCustomerId = await redis.get(`stripe:user:${userId}`);

    // Create a new Stripe customer if this user doesn't have one
    if (!stripeCustomerId) {
      const stripe = getStripe();
      const newCustomer = await stripe.customers.create({
        email: email,
        metadata: {
          userId: userId, // DO NOT FORGET THIS
        },
      });

      // Store the relation between userId and stripeCustomerId in Redis
      await redis.set(`stripe:user:${userId}`, newCustomer.id);

      const customer = {
        id: newCustomer.id,
        email: newCustomer.email,
      };

      logger.info({ customerId: customer.id }, 'New Stripe customer created');
      telemetry?.set({
        'stripe.customer.created': true,
        'stripe.customer.id': customer.id,
      });

      return { customer, isExisting: false };
    }

    // Retrieve existing customer from Stripe
    const stripe = getStripe();
    const existingCustomer = await stripe.customers.retrieve(stripeCustomerId);

    if (existingCustomer.deleted) {
      // Customer was deleted, create a new one
      const newCustomer = await stripe.customers.create({
        email: email,
        metadata: {
          userId: userId,
        },
      });

      // Update the relation in Redis
      await redis.set(`stripe:user:${userId}`, newCustomer.id);

      const customer = {
        id: newCustomer.id,
        email: newCustomer.email,
      };

      logger.info(
        { customerId: customer.id },
        'Replaced deleted Stripe customer with new one',
      );
      telemetry?.set({
        'stripe.customer.recreated': true,
        'stripe.customer.id': customer.id,
      });

      return { customer, isExisting: false };
    }

    const customer = {
      id: existingCustomer.id,
      email: existingCustomer.email,
    };

    telemetry?.set({
      'stripe.customer.existing': true,
      'stripe.customer.id': customer.id,
    });

    // Check for active subscription
    await validateNoActiveSubscription(customer.id, telemetry);
    return { customer, isExisting: true };
  };

  try {
    if (telemetry) {
      return await telemetry.withSpan(
        'stripe.findOrCreateCustomer',
        operation,
        {
          attributes: { 'stripe.operation': 'customers.create_or_retrieve' },
        },
      );
    }
    return await operation();
  } catch (error) {
    if (error instanceof TRPCError) throw error;

    logger.error({ error }, 'Customer management error');
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Customer management failed',
    });
  }
}

async function validateNoActiveSubscription(
  customerId: string,
  telemetry?: Telemetry,
): Promise<void> {
  const stripe = getStripe();
  const subscriptions = await stripe.subscriptions.list({
    customer: customerId,
    status: 'active',
    limit: SUBSCRIPTION_SEARCH_LIMIT,
  });

  telemetry?.set({
    'stripe.subscription.active_count': subscriptions.data.length,
  });

  if (subscriptions.data.length > 0) {
    logger.warn(
      { customerId, activeSubscriptions: subscriptions.data.length },
      'Customer already has an active subscription',
    );
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Customer already has an active subscription',
    });
  }
}

export async function createCheckoutSession(
  customer: StripeCustomer,
  defaultPriceId: string,
  productId: string,
  telemetry?: Telemetry,
): Promise<Stripe.Checkout.Session> {
  const operation = async () => {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customer.id,
      line_items: [
        {
          price: defaultPriceId,
          quantity: DEFAULT_QUANTITY,
        },
      ],
      success_url: env.STRIPE_SUCCESS_URL,
      cancel_url: env.STRIPE_CANCEL_URL,
      saved_payment_method_options: {
        payment_method_save: 'enabled',
      },
      subscription_data: {
        metadata: {
          customerId: customer.id,
          customerEmail: customer.email ?? '',
          initialCheckoutTimestamp: new Date().toISOString(),
          productId: productId,
        },
      },
    });

    logger.info(
      { sessionId: session.id, customerId: customer.id, productId },
      'Checkout session created',
    );
    telemetry?.set({
      'stripe.checkout.session_id': session.id,
      'stripe.checkout.customer_id': customer.id,
      'stripe.checkout.product_id': productId,
    });

    return session;
  };

  if (telemetry) {
    return await telemetry.withSpan('stripe.createCheckoutSession', operation, {
      attributes: { 'stripe.operation': 'checkout.sessions.create' },
    });
  }
  return await operation();
}

/**
 * Process Stripe webhook events and sync data to KV store
 */
export async function processEvent(event: Stripe.Event): Promise<void> {
  // Skip processing if the event isn't one I'm tracking (list of all events below)
  if (!allowedEvents.has(event.type)) return;

  // All the events I track have a customerId
  const { customer: customerId } = event.data.object as {
    customer: string; // Sadly TypeScript does not know this
  };

  // This helps make it typesafe and also lets me know if my assumption is wrong
  if (typeof customerId !== 'string') {
    throw new TypeError(
      `[STRIPE HOOK] ID isn't string.\nEvent type: ${event.type}`,
    );
  }

  await syncStripeDataToKV(customerId);
}

/**
 * A simple try-catch wrapper that returns an error object instead of throwing
 */
export async function tryCatch<T>(
  fn: () => Promise<T>,
): Promise<{ data?: T; error?: Error }> {
  try {
    const data = await fn();
    return { data };
  } catch (error) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }
}

/**
 * Create a Stripe billing portal session for subscription management
 * This replaces the complex upgrade/downgrade logic and lets Stripe handle everything
 */
export async function createDashboardSession(
  customerId: string,
  telemetry?: Telemetry,
): Promise<{
  billingPortalUrl: string;
}> {
  const operation = async () => {
    const stripe = getStripe();

    // Create a billing portal session - Stripe handles all subscription management
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: env.STRIPE_SUCCESS_URL, // User returns here after making changes
    });

    logger.info(
      { customerId, sessionId: session.id },
      'Billing portal session created',
    );
    telemetry?.set({
      'stripe.billing_portal.session_id': session.id,
      'stripe.billing_portal.customer_id': customerId,
    });

    return {
      billingPortalUrl: session.url,
    };
  };

  if (telemetry) {
    return await telemetry.withSpan(
      'stripe.createDashboardSession',
      operation,
      {
        attributes: { 'stripe.operation': 'billingPortal.sessions.create' },
      },
    );
  }
  return await operation();
}

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
      expand: ['data.default_payment_method', 'data.items.data.price'],
    });

    if (subscriptions.data.length === 0 || !subscriptions.data[0]) {
      const none = { status: 'none' } as const;
      await redis.set(`stripe:customer:${customerId}`, JSON.stringify(none));
      telemetry?.set({
        'stripe.sync.result': 'no_subscription',
        'stripe.sync.customer_id': customerId,
      });
      return none;
    }

    const subscription = subscriptions.data[0];
    const productId = subscription.items.data[0]?.price.product;

    const candidate: STRIPE_SUB_CACHE = {
      subscriptionId: subscription.id,
      status: subscription.status,
      product: typeof productId === 'string' ? productId : null,
      priceId: subscription.items.data[0]?.price.id ?? null,
      currentPeriodStart:
        subscription.items.data[0]?.current_period_start ?? null,
      currentPeriodEnd: subscription.items.data[0]?.current_period_end ?? null,
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

    await redis.set(`stripe:customer:${customerId}`, JSON.stringify(subData));

    return subData;
  };

  if (telemetry) {
    return await telemetry.withSpan('stripe.syncStripeDataToKV', operation, {
      attributes: { 'stripe.operation': 'subscriptions.list' },
    });
  }
  return await operation();
}
