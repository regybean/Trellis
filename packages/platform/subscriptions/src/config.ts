import { z } from 'zod/v4';

import type { ConfigContext } from '@acme/config';
import { createConfig } from '@acme/config';

/**
 * Subscriptions config-as-code (ADR 0026). The per-tier monthly Credit limits
 * and the unknown-tier fallback were hardcoded in `credit-policy.ts`; they are
 * business tunables that can legitimately differ per deploy target (a promo env
 * with higher caps, say), so they live here as profile values rather than as
 * source literals. Server-only — the credit policy runs on the backend.
 */
export function subscriptionsConfig(context: ConfigContext) {
  return createConfig({
    server: {
      // Keyed by `SubscriptionTier` ('Basic' | 'Standard' | 'Pro'); a loose
      // record keeps `creditLimitFor`'s fallback for an unmapped tier honest.
      CREDIT_LIMITS: z.record(z.string(), z.number().int().positive()),
      DEFAULT_LIMIT: z.number().int().positive(),
    },
    profiles: {
      default: {
        server: {
          CREDIT_LIMITS: { Basic: 250, Standard: 350, Pro: 1600 },
          DEFAULT_LIMIT: 250,
        },
      },
    },
    context,
  });
}
