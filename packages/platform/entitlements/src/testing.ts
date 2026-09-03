/**
 * The test double for the entitlements contract — a mock `EntitlementsProvider`
 * a backend test injects into its tRPC context.
 *
 * It lives here, next to the contract it implements, for the same reason
 * `unlimitedEntitlements` does: the tier vocabulary is this package's, so this
 * is the only package that can name `SubscriptionTier` and `CreditBalance`
 * without acquiring a billing dependency. It used to live in `@acme/trpc/testing`,
 * which meant every feature's test context imported tiers and credits to build a
 * caller — `feedback` and `ingest` included, neither of which has a tier to set
 * (#256, ADR 0006 amendment).
 *
 * Shipped on the `./testing` subpath so production code never pulls it in.
 */
import type {
  CreditBalance,
  Entitlements,
  EntitlementsProvider,
  SubscriptionCache,
  SubscriptionTier,
} from './types';
import { isTierAtLeast } from './tiers';

/** The billing knobs a test varies per caller. */
export interface TestEntitlementsOptions {
  tier: SubscriptionTier;
  credits: CreditBalance;
}

/**
 * The subscription a real `@acme/subscriptions` adapter would resolve for a
 * tier. `Basic` is the canonical no-billing `{ status: 'none' }`; paid tiers get
 * an active, Stripe-shaped record so billing's tier gate and `subscription.status`
 * reads run against a realistic shape.
 */
function subscriptionForTier(tier: SubscriptionTier): SubscriptionCache {
  if (tier === 'Basic') return { status: 'none' };
  const periodStart = Math.floor(Date.now() / 1000);
  return {
    status: 'active',
    subscriptionId: 'sub_test',
    product: tier === 'Standard' ? 'prod_standard_test' : 'prod_pro_test',
    priceId: tier === 'Standard' ? 'price_standard_test' : 'price_pro_test',
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodStart + 86_400 * 30,
    cancelAtPeriodEnd: false,
    paymentMethod: null,
  };
}

/** What the mock provider's `resolve()` answers with, for a given tier. */
function resolveEntitlements(opts: TestEntitlementsOptions): Entitlements {
  return {
    subscription: subscriptionForTier(opts.tier),
    tier: opts.tier,
    credits: opts.credits,
  };
}

/**
 * A mock `EntitlementsProvider`: `resolve` echoes the tier/credits with a
 * tier-faithful subscription, `consume` and `refund` are no-ops (no Redis —
 * the real Redis-backed ledger is covered in `@acme/subscriptions`), and
 * `isTierAtLeast` is the REAL ordering from this package so tier gates behave
 * exactly as in production.
 */
export function createMockEntitlements(opts: TestEntitlementsOptions) {
  const resolved = resolveEntitlements(opts);
  return {
    resolve: () => Promise.resolve(resolved),
    consume: () => Promise.resolve(),
    refund: () => Promise.resolve(),
    isTierAtLeast,
  } satisfies EntitlementsProvider;
}
