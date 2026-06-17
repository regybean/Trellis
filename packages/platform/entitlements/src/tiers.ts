import type { SubscriptionTier } from './types';

const TIER_RANK = new Map<SubscriptionTier, number>([
  ['Basic', 0],
  ['Standard', 1],
  ['Pro', 2],
]);

/**
 * Tests the tier ordering `Basic < Standard < Pro`: `true` when `tier` is at
 * least `minTier`. The single source of truth for hierarchical tier-gating
 * (see `requireTier` in `@acme/trpc`); every `EntitlementsProvider` exposes it
 * as its `isTierAtLeast` method.
 */
export function isTierAtLeast(
  tier: SubscriptionTier,
  minTier: SubscriptionTier,
): boolean {
  return (TIER_RANK.get(tier) ?? 0) >= (TIER_RANK.get(minTier) ?? 0);
}
