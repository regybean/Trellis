import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod/v4';

import { jsonEnv, readEnv, resolveAppEnv, withProfiles } from '@acme/env';

/** The deploy-target selector, resolved at this slice's `process.env` edge. */
const appEnv = resolveAppEnv(process.env.APP_ENV);

/**
 * Subscriptions' environment, declared once (ADR 0033). The per-tier monthly
 * Credit limits and the unknown-tier fallback were hardcoded in
 * `credit-policy.ts`; they are business tunables that can legitimately differ per
 * deploy target (a promo env with higher caps, say), so they are authored here as
 * profile values rather than as source literals. Server-only — the credit policy
 * runs on the backend.
 *
 * `CREDIT_LIMITS` is a record, so it goes through `jsonEnv`: an environment
 * variable is a string and a record has no scalar coercion, so without it the key
 * would be overridable in name only. It is overridden **whole** —
 * `CREDIT_LIMITS='{"Basic":10}'`, not `CREDIT_LIMITS__Basic=10` — which keeps the
 * tier map a single validated document instead of a set of independent knobs.
 *
 * The Stripe plan ids this slice used to declare live in `@acme/billing`'s env;
 * `subscriptions.ts` takes them as an injected `PlanIds` rather than reading them
 * here.
 */
export const env = createEnv({
  clientPrefix: 'NEXT_PUBLIC_',
  client: {},
  server: {
    // Keyed by `SubscriptionTier` ('Basic' | 'Standard' | 'Pro'); a loose record
    // keeps `creditLimitFor`'s fallback for an unmapped tier honest.
    CREDIT_LIMITS: jsonEnv(
      z.record(z.string(), z.coerce.number().int().positive()),
    ),
    DEFAULT_LIMIT: z.coerce.number().int().positive(),
  },
  createFinalSchema: (shape) =>
    withProfiles(shape, appEnv, {
      default: {
        CREDIT_LIMITS: { Basic: 250, Standard: 350, Pro: 1600 },
        DEFAULT_LIMIT: 250,
      },
    }),
  runtimeEnv: {
    CREDIT_LIMITS: readEnv('CREDIT_LIMITS'),
    DEFAULT_LIMIT: readEnv('DEFAULT_LIMIT'),
  },
  emptyStringAsUndefined: true,
});
