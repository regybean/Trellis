import Stripe from 'stripe';

import type { SubscriptionCache } from '@acme/subscriptions';

import { env } from '../env';
import { deriveLocalstripeMode } from '../lib/localstripe-mode';

// Shared Stripe types
export interface StripeCustomer {
  id: string;
  email: string | null;
}

export type STRIPE_SUB_CACHE = SubscriptionCache;

/**
 * localstripe mode — derived once from the `STRIPE_API_BASE` env carve-out
 * (ADR 0003/0004). The single boolean the server branches that only need a
 * boolean (the skipped expands in `stripe-sync`, the `setUserTier` guard in
 * `stripe-dev`) read, and — threaded through `BillingConfigProvider` — the value
 * the client reads instead of proxying the condition through `NODE_ENV`. The SDK
 * host override below still reads the raw `STRIPE_API_BASE` because it needs the
 * URL to parse, not just the boolean.
 */
export const localstripeMode = deriveLocalstripeMode(env.STRIPE_API_BASE);

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
