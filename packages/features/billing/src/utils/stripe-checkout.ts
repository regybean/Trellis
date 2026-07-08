import type Stripe from 'stripe';

import { logger } from '@acme/logger';
import { getStripeCustomerId, setStripeCustomerId } from '@acme/subscriptions';
import { setSpanAttributes, withSpan } from '@acme/telemetry/server';

import type { StripeCustomer } from './stripe-client';
import { env } from '../env';
import { getStripe } from './stripe-client';
import {
  billingError,
  BillingErrorCode,
  toBillingErrorCode,
} from './stripe-errors';

// Constants
const DEFAULT_QUANTITY = 1;
const SUBSCRIPTION_SEARCH_LIMIT = 1;

export async function getProductWithPrice(
  productId: string,
): Promise<{ defaultPriceId: string; productId: string }> {
  try {
    return await withSpan(
      'stripe.getProductWithPrice',
      async () => {
        const stripe = getStripe();
        const product = await stripe.products.retrieve(productId);

        let defaultPriceId =
          typeof product.default_price === 'string'
            ? product.default_price
            : undefined;

        // localstripe (and legacy data) predates the Prices API: products carry
        // no default_price, only legacy Plans. Fall back to the product's plan,
        // whose id is accepted as line_items[].price. No-op on real Stripe. See
        // ADR-0003.
        if (!defaultPriceId) {
          const plans = await stripe.plans.list({
            product: productId,
            limit: 1,
          });
          defaultPriceId = plans.data[0]?.id;
        }

        if (!defaultPriceId) {
          logger.error({ productId }, 'Product does not have a default price');
          throw billingError(
            BillingErrorCode.NoDefaultPrice,
            'BAD_REQUEST',
            'Product does not have a default price',
          );
        }

        setSpanAttributes({
          'stripe.product.id': productId,
          'stripe.price.id': defaultPriceId,
        });

        return { defaultPriceId, productId };
      },
      { attributes: { 'stripe.operation': 'products.retrieve' } },
    );
  } catch (error) {
    if (toBillingErrorCode(error)) throw error;

    logger.error({ error, productId }, 'Error retrieving product from Stripe');
    throw billingError(
      BillingErrorCode.StripeUnavailable,
      'INTERNAL_SERVER_ERROR',
      'Internal Server Error',
    );
  }
}

export async function findOrCreateCustomer(
  email: string,
  userId: string,
): Promise<{ customer: StripeCustomer; isExisting: boolean }> {
  try {
    return await withSpan(
      'stripe.findOrCreateCustomer',
      async () => {
        // Get the stripeCustomerId from Redis KV store
        const stripeCustomerId = await getStripeCustomerId(userId);

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
          await setStripeCustomerId(userId, newCustomer.id);

          const customer = {
            id: newCustomer.id,
            email: newCustomer.email,
          };

          logger.info(
            { customerId: customer.id },
            'New Stripe customer created',
          );
          setSpanAttributes({
            'stripe.customer.created': true,
            'stripe.customer.id': customer.id,
          });

          return { customer, isExisting: false };
        }

        // Retrieve existing customer from Stripe
        const stripe = getStripe();
        const existingCustomer =
          await stripe.customers.retrieve(stripeCustomerId);

        if (existingCustomer.deleted) {
          // Customer was deleted, create a new one
          const newCustomer = await stripe.customers.create({
            email: email,
            metadata: {
              userId: userId,
            },
          });

          // Update the relation in Redis
          await setStripeCustomerId(userId, newCustomer.id);

          const customer = {
            id: newCustomer.id,
            email: newCustomer.email,
          };

          logger.info(
            { customerId: customer.id },
            'Replaced deleted Stripe customer with new one',
          );
          setSpanAttributes({
            'stripe.customer.recreated': true,
            'stripe.customer.id': customer.id,
          });

          return { customer, isExisting: false };
        }

        const customer = {
          id: existingCustomer.id,
          email: existingCustomer.email,
        };

        setSpanAttributes({
          'stripe.customer.existing': true,
          'stripe.customer.id': customer.id,
        });

        // Check for active subscription
        await validateNoActiveSubscription(customer.id);
        return { customer, isExisting: true };
      },
      { attributes: { 'stripe.operation': 'customers.create_or_retrieve' } },
    );
  } catch (error) {
    if (toBillingErrorCode(error)) throw error;

    logger.error({ error }, 'Customer management error');
    throw billingError(
      BillingErrorCode.CustomerManagementFailed,
      'INTERNAL_SERVER_ERROR',
      'Customer management failed',
    );
  }
}

async function validateNoActiveSubscription(customerId: string): Promise<void> {
  const stripe = getStripe();
  const subscriptions = await stripe.subscriptions.list({
    customer: customerId,
    status: 'active',
    limit: SUBSCRIPTION_SEARCH_LIMIT,
  });

  setSpanAttributes({
    'stripe.subscription.active_count': subscriptions.data.length,
  });

  if (subscriptions.data.length > 0) {
    logger.warn(
      { customerId, activeSubscriptions: subscriptions.data.length },
      'Customer already has an active subscription',
    );
    throw billingError(
      BillingErrorCode.ActiveSubscription,
      'BAD_REQUEST',
      'Customer already has an active subscription',
    );
  }
}

export async function createCheckoutSession(
  customer: StripeCustomer,
  defaultPriceId: string,
  productId: string,
): Promise<Stripe.Checkout.Session> {
  return await withSpan(
    'stripe.createCheckoutSession',
    async () => {
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
      setSpanAttributes({
        'stripe.checkout.session_id': session.id,
        'stripe.checkout.customer_id': customer.id,
        'stripe.checkout.product_id': productId,
      });

      return session;
    },
    { attributes: { 'stripe.operation': 'checkout.sessions.create' } },
  );
}

/**
 * Create a Stripe billing portal session for subscription management
 * This replaces the complex upgrade/downgrade logic and lets Stripe handle everything
 */
export async function createDashboardSession(customerId: string): Promise<{
  billingPortalUrl: string;
}> {
  return await withSpan(
    'stripe.createDashboardSession',
    async () => {
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
      setSpanAttributes({
        'stripe.billing_portal.session_id': session.id,
        'stripe.billing_portal.customer_id': customerId,
      });

      return {
        billingPortalUrl: session.url,
      };
    },
    { attributes: { 'stripe.operation': 'billingPortal.sessions.create' } },
  );
}
