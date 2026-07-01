import type Stripe from 'stripe';

import type { SubscriptionTier } from '@acme/subscriptions';
import type { Telemetry } from '@acme/telemetry/server';
import { getStripeCustomerId, setStripeCustomerId } from '@acme/subscriptions';

import type { STRIPE_SUB_CACHE } from './stripe-client';
import { env } from '../env';
import { getStripe } from './stripe-client';
import { billingError, BillingErrorCode } from './stripe-errors';
import { syncStripeDataToKV } from './stripe-sync';

/**
 * Resolve (or create) the Stripe customer for a user, without the active-
 * subscription guard in findOrCreateCustomer — setUserTier intentionally
 * re-grants over an existing subscription.
 */
async function resolveCustomerId(
  email: string,
  userId: string,
): Promise<string> {
  const stripe = getStripe();
  const existing = await getStripeCustomerId(userId);
  if (existing) {
    const customer = await stripe.customers.retrieve(existing);
    if (!customer.deleted) return existing;
  }
  const created = await stripe.customers.create({
    email,
    metadata: { userId },
  });
  await setStripeCustomerId(userId, created.id);
  return created.id;
}

/**
 * localstripe models the legacy Plans API, so we look the plan up by the
 * product the tier maps to rather than hard-coding seed plan IDs.
 */
async function findPlanForProduct(productId: string): Promise<Stripe.Plan> {
  const stripe = getStripe();
  const plans = await stripe.plans.list({ limit: 100 });
  const plan = plans.data.find((p) => {
    const ref = p.product;
    return (typeof ref === 'string' ? ref : ref?.id) === productId;
  });
  if (!plan) {
    throw billingError(
      BillingErrorCode.MissingPlan,
      'PRECONDITION_FAILED',
      `No localstripe plan for product ${productId}; run pnpm infra:up to seed.`,
    );
  }
  return plan;
}

/**
 * Admin-only, localstripe-only: move a user to a billing tier directly, with no
 * Stripe Checkout. Cancels any existing subscription first (so tier changes and
 * downgrades don't stack), then for a paid tier attaches localstripe's test
 * card and creates an active subscription on the matching plan. 'Basic' just
 * cancels. Syncs Redis immediately so the admin UI is deterministic.
 *
 * Guarded on STRIPE_API_BASE so it can never run against real Stripe.
 */
export async function setUserTier(
  args: { userId: string; email: string; tier: SubscriptionTier },
  telemetry?: Telemetry,
): Promise<STRIPE_SUB_CACHE> {
  const { userId, email, tier } = args;

  if (!env.STRIPE_API_BASE) {
    throw billingError(
      BillingErrorCode.DevOnly,
      'PRECONDITION_FAILED',
      'setUserTier is only available in local dev with localstripe',
    );
  }

  const stripe = getStripe();
  const customerId = await resolveCustomerId(email, userId);

  // Clean slate: cancel any non-canceled subscription so a tier change doesn't
  // leave the customer on two plans.
  const existing = await stripe.subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 100,
  });
  for (const sub of existing.data) {
    if (sub.status !== 'canceled') {
      await stripe.subscriptions.cancel(sub.id);
    }
  }

  if (tier !== 'Basic') {
    const productId =
      tier === 'Pro'
        ? env.NEXT_PUBLIC_STRIPE_PRO_PLAN_ID
        : env.NEXT_PUBLIC_STRIPE_STANDARD_PLAN_ID;
    const plan = await findPlanForProduct(productId);

    // Attach localstripe's built-in 4242 test card and make it the customer's
    // default so the first invoice is paid immediately — otherwise the
    // subscription stays `incomplete` and never becomes `active`. localstripe's
    // subscription create doesn't accept default_payment_method (only the
    // customer-level invoice_settings default), and the subscription inherits
    // it from there.
    const pm = await stripe.paymentMethods.attach('pm_card_visa', {
      customer: customerId,
    });
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: pm.id },
    });

    await stripe.subscriptions.create({
      customer: customerId,
      items: [{ plan: plan.id }],
    });
  }

  const subData = await syncStripeDataToKV(customerId, telemetry);

  telemetry?.set({
    'admin.action': 'set_user_tier',
    'admin.target_user_id': userId,
    'admin.tier': tier,
    'admin.subscription_status': subData.status,
  });

  return subData;
}
