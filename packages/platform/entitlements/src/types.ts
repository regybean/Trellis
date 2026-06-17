/**
 * The entitlements contract: the neutral shape the platform tRPC substrate
 * (`@acme/trpc`) consumes for billing decisions (rate limiting + tier gating),
 * with zero knowledge of how those entitlements are sourced. A full deployment
 * injects the Stripe/Redis-backed adapter from `@acme/subscriptions`; a
 * deployment with no billing injects `unlimitedEntitlements`. See
 * docs/adr/0006-entitlements-injection-seam.md.
 */

/** The three subscription tiers, ordered `Basic < Standard < Pro`. */
export type SubscriptionTier = 'Basic' | 'Standard' | 'Pro';

type SubscriptionStatus =
  | 'active'
  | 'past_due'
  | 'unpaid'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'trialing'
  | 'paused';

/**
 * Neutral subscription state read by the platform substrate. The
 * `{ status: 'none' }` variant is the canonical "no billing" state — what
 * `unlimitedEntitlements` returns and what a deployment without Stripe always
 * sees. Relocated verbatim from `@acme/subscriptions`; its Stripe-shaped active
 * variant is produced only by the `@acme/subscriptions` adapter, and
 * `@acme/subscriptions` owns the matching Zod schema that validates it.
 */
export type SubscriptionCache =
  | { status: 'none' }
  | {
      status: SubscriptionStatus;
      subscriptionId: string | null;
      product: string | null;
      priceId: string | null;
      currentPeriodStart: number | null;
      currentPeriodEnd: number | null;
      cancelAtPeriodEnd: boolean;
      paymentMethod: { brand: string | null; last4: string | null } | null;
    };

/** A user's current Credit balance for their tier within the billing window. */
export interface CreditBalance {
  remaining: number;
  limit: number;
  resetAt: number;
}

/** The resolved entitlements for a caller: subscription + tier + credits. */
export interface Entitlements {
  subscription: SubscriptionCache;
  tier: SubscriptionTier;
  credits: CreditBalance;
}

/**
 * The injected policy the platform calls instead of importing a billing
 * implementation. Apps wire a concrete provider into `createTRPCContext`.
 */
export interface EntitlementsProvider {
  /** Resolve the caller's current entitlements (subscription + tier + credits). */
  resolve(userId: string | null): Promise<Entitlements>;
  /** Decrement the caller's Credit balance after a guarded request. */
  consume(
    userId: string,
    tier: SubscriptionTier,
    amount: number,
  ): Promise<void>;
  /** Tier ordering test: `true` when `tier` is at least `minTier`. */
  isTierAtLeast(tier: SubscriptionTier, minTier: SubscriptionTier): boolean;
}
