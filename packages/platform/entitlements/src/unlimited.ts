import type { EntitlementsProvider } from './types';
import { isTierAtLeast } from './tiers';

const UNLIMITED = Number.MAX_SAFE_INTEGER;

/**
 * Entitlements for a deployment with no billing: every caller is the top tier
 * (`Pro`, so `requireTier` always admits) with effectively infinite credits and
 * a no-op `consume` (nothing to decrement). Apps that drop `@acme/subscriptions`
 * — e.g. a single-user slim app — inject this. Pure: no Redis, no Stripe, no env.
 */
export const unlimitedEntitlements: EntitlementsProvider = {
  resolve() {
    return Promise.resolve({
      subscription: { status: 'none' },
      tier: 'Pro',
      credits: { remaining: UNLIMITED, limit: UNLIMITED, resetAt: 0 },
    });
  },
  consume() {
    return Promise.resolve();
  },
  isTierAtLeast,
};
