import { beforeEach, describe, expect, it } from 'vitest';

import { flushTestDb } from '@acme/redis/testing';

import { createSubscriptionsEntitlements } from '../../../../entitlements-adapter';

// Plan ids the provider maps products to (billing-env values, injected at the
// app edge in production — supplied directly here since config is pure).
const subscriptionsEntitlements = createSubscriptionsEntitlements({
  standardPlanId: 'price_standard_test',
  proPlanId: 'price_pro_test',
});

/**
 * Service test for the Stripe/Redis-backed `EntitlementsProvider` against a REAL
 * Redis (the isolated logical DB from this suite's vitest config) — no
 * `@acme/redis` mock (ADR 0014). Exercises the adapter through the neutral
 * contract only (`resolve`/`consume`/`refund`), asserting the observable Credit
 * balance rather than the private key format: `refund` must delegate to the
 * Redis-backed `credits.refund`, crediting the same ledger `consume` decrements.
 */

const USER = 'user_adapter_refund';

beforeEach(async () => {
  await flushTestDb();
});

describe('subscriptionsEntitlements.refund', () => {
  it('delegates to the Redis-backed credit ledger, inverting a consume', async () => {
    // Basic tier (no seeded subscription): the eager-init limit materialises.
    const { tier, credits: initial } =
      await subscriptionsEntitlements.resolve(USER);

    await subscriptionsEntitlements.consume(USER, tier, 10);
    await subscriptionsEntitlements.refund(USER, tier, 4);

    const { credits: after } = await subscriptionsEntitlements.resolve(USER);
    // Net movement is -10 + 4 = -6, proving the refund hit the same ledger.
    expect(after.remaining).toBe(initial.remaining - 6);
  });

  it('credits the balance back by the exact amount', async () => {
    const { tier, credits: initial } =
      await subscriptionsEntitlements.resolve(USER);

    await subscriptionsEntitlements.refund(USER, tier, 7);

    const { credits: after } = await subscriptionsEntitlements.resolve(USER);
    expect(after.remaining).toBe(initial.remaining + 7);
  });
});
