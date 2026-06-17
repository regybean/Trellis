import { z } from 'zod/v4';

import type { SubscriptionCache as ContractSubscriptionCache } from '@acme/entitlements';

const SubscriptionStatus = z.enum([
  'active',
  'past_due',
  'unpaid',
  'canceled',
  'incomplete',
  'incomplete_expired',
  'trialing',
  'paused',
]);

export const SubscriptionCacheSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('none') }),
  z.object({
    status: SubscriptionStatus,
    subscriptionId: z.string().nullable(),
    product: z.string().nullable(),
    priceId: z.string().nullable(),
    currentPeriodStart: z.number().int().nullable(),
    currentPeriodEnd: z.number().int().nullable(),
    cancelAtPeriodEnd: z.boolean(),
    paymentMethod: z
      .object({
        brand: z.string().nullable(),
        last4: z.string().nullable(),
      })
      .nullable(),
  }),
]);

// The subscription/tier types are owned by the neutral `@acme/entitlements`
// contract; this package owns the Zod schema that validates the Stripe-shaped
// cache and re-exports the contract types alongside it.
export type { SubscriptionCache, SubscriptionTier } from '@acme/entitlements';

// Drift guard: the Stripe-shaped Zod schema must stay assignable to the neutral
// `SubscriptionCache` contract type. A schema change that diverges from the
// contract fails to compile here.
type _SchemaConformsToContract =
  z.infer<typeof SubscriptionCacheSchema> extends ContractSubscriptionCache
    ? true
    : never;
const _schemaConformsToContract: _SchemaConformsToContract = true;
