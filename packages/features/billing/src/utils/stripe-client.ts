import Stripe from 'stripe';

import type { SubscriptionCache } from '@acme/subscriptions';

import { env } from '../env';

// Shared Stripe types
export interface StripeCustomer {
  id: string;
  email: string | null;
}

export type STRIPE_SUB_CACHE = SubscriptionCache;

// Lazy initialization to avoid module-time errors in CICD tests
let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    if (!env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY is required');
    }
    _stripe = new Stripe(env.STRIPE_SECRET_KEY, {
      httpClient: Stripe.createFetchHttpClient(),
      // Dev-only: route the SDK at a localstripe server. Unset → real Stripe.
      ...localstripeConfig(),
    });
  }
  return _stripe;
}

/**
 * When STRIPE_API_BASE is set (local dev with localstripe), parse it into the
 * host/port/protocol overrides the Stripe SDK uses to target an alternate
 * server. Returns an empty object in prod so SDK defaults are untouched.
 */
function localstripeConfig() {
  if (!env.STRIPE_API_BASE) return {};
  const url = new URL(env.STRIPE_API_BASE);
  const isHttps = url.protocol === 'https:';
  const protocol: 'http' | 'https' = isHttps ? 'https' : 'http';
  return {
    host: url.hostname,
    port: Number(url.port) || (isHttps ? 443 : 80),
    protocol,
  };
}
