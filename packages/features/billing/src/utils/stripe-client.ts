import Stripe from 'stripe';

import type { SubscriptionCache } from '@acme/subscriptions';

import { env } from '../env';

// Shared Stripe types
export interface StripeCustomer {
  id: string;
  email: string | null;
}

export type STRIPE_SUB_CACHE = SubscriptionCache;

// The Stripe connection, resolved once from this slice's env (ADR 0033):
// `localstripe` (dev, against the fake stateful server) or `real`. The SDK host
// override reads `apiBase` off the narrowed `localstripe` variant.
const stripe = env.STRIPE_CONNECTION;

/**
 * localstripe mode — the single boolean the server branches that only need a
 * boolean (the skipped expands in `stripe-sync`, the `setUserTier` guard in
 * `stripe-dev`) read, and — threaded through `BillingConfigProvider` — the value
 * the client reads instead of proxying the condition through `NODE_ENV`.
 */
export const localstripeMode = stripe.mode === 'localstripe';

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
 * In localstripe mode, parse the connection's `apiBase` into the
 * host/port/protocol overrides the Stripe SDK uses to target an alternate
 * server. Returns an empty object for real Stripe so SDK defaults are untouched.
 */
function localstripeConfig() {
  if (stripe.mode !== 'localstripe') return {};
  const url = new URL(stripe.apiBase);
  const isHttps = url.protocol === 'https:';
  const protocol: 'http' | 'https' = isHttps ? 'https' : 'http';
  return {
    host: url.hostname,
    port: Number(url.port) || (isHttps ? 443 : 80),
    protocol,
  };
}
