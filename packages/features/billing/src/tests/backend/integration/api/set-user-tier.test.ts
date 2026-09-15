/**
 * `account.setUserTier` against a real Stripe server.
 *
 * The one path in this slice that runs for real. Everywhere else in this suite
 * the Stripe-calling services are mocked in `setup.ts`, which meant the tier
 * grant — cancel, attach a card, create a subscription, mirror to Redis — was
 * asserted only against `vi.fn().mockResolvedValue({ status: 'active' })`. Here
 * the module is unmocked and the work happens in localstripe, the same fake
 * stateful server dev runs on, started as this suite's own throwaway container.
 *
 * `@acme/subscriptions` is unmocked too, and has to be: the point of the test is
 * what `getSubscriptionType` resolves the grant to, and a mock that returns
 * `'Basic'` unconditionally cannot answer that. Its Redis reads and writes go to
 * the suite's isolated logical DB.
 *
 * Both unmocks are per-file — the blanket mock still stands for every other file
 * in this suite.
 *
 * This is the test ../../../../../docs/adr/0001-localstripe-dev-billing.md asked
 * for: it records whether attaching `pm_card_visa` moves a fresh subscription to
 * `active` in localstripe 1.15.10, and whether the seeded plan/product wiring
 * round-trips through `getSubscriptionType` to the expected tier.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';

import {
  getStripeCustomerId,
  getSubscriptionType,
  getUserSubscriptionFromRedis,
} from '@acme/subscriptions';

import type { TestContextOptions } from '../../utils/test-context';
import { appRouter } from '../../../../api/root';
import { getStripe } from '../../../../api/services/stripe-client';
import { env, toPlanIds } from '../../../../env';
import { seedLocalstripePlans } from '../../../../testing';
import { createTestUserId } from '../../utils/fixtures';
import { createTestContext } from '../../utils/test-context';

vi.unmock('../../../../api/services/stripe-dev');
vi.unmock('@acme/subscriptions');

const planIds = toPlanIds(env);

function createAdminCaller(opts?: Partial<TestContextOptions>) {
  const ctx = createTestContext({
    userId: createTestUserId('admin'),
    role: 'admin',
    tier: 'Basic',
    credits: { remaining: 250, limit: 250, resetAt: Date.now() },
    ...opts,
  });
  return appRouter.createCaller(ctx);
}

// localstripe keeps products and plans in memory, so a fresh container has
// none. Seeded once per file through the same function `pnpm infra:up` uses, so
// the products the grant looks up are the ones the env names.
beforeAll(async () => {
  await seedLocalstripePlans(getStripe(), planIds);
});

describe('account.setUserTier against localstripe', () => {
  it('grants Standard as an active subscription on the Standard product', async () => {
    const userId = createTestUserId('target');

    const result = await createAdminCaller().account.setUserTier({
      userId,
      email: 'target@example.com',
      tier: 'Standard',
      productId: planIds.standardPlanId,
    });

    // The ADR's first known unknown: `pm_card_visa` + the customer-level
    // default payment method does pay the first invoice, so the subscription is
    // `active` rather than stuck `incomplete`.
    expect(result.status).toBe('active');

    // ...and its second: the grant round-trips through the Redis cache to the
    // tier the product maps to. Read back through the real cache rather than
    // off the mutation's return, so what a later request would see is what is
    // asserted.
    const cached = await getUserSubscriptionFromRedis(userId);
    expect(cached.status).toBe('active');
    expect(getSubscriptionType(cached, planIds)).toBe('Standard');
  });

  it('grants Pro on the Pro product', async () => {
    const userId = createTestUserId('target');

    const result = await createAdminCaller().account.setUserTier({
      userId,
      email: 'target@example.com',
      tier: 'Pro',
      productId: planIds.proPlanId,
    });

    expect(result.status).toBe('active');

    const cached = await getUserSubscriptionFromRedis(userId);
    expect(getSubscriptionType(cached, planIds)).toBe('Pro');
  });

  // The downgrade path takes the `tier === 'Basic'` branch: cancel, create
  // nothing. Worth its own case because it is the only branch that reaches
  // `syncStripeDataToKV` with no subscription to find.
  it('cancels the subscription when dropped back to Basic', async () => {
    const userId = createTestUserId('target');
    const caller = createAdminCaller();

    await caller.account.setUserTier({
      userId,
      email: 'target@example.com',
      tier: 'Pro',
      productId: planIds.proPlanId,
    });

    const result = await caller.account.setUserTier({
      userId,
      email: 'target@example.com',
      tier: 'Basic',
    });

    expect(result.status).not.toBe('active');
    expect(
      getSubscriptionType(await getUserSubscriptionFromRedis(userId), planIds),
    ).toBe('Basic');
  });

  // Re-granting over a live subscription is the admin UI's normal case (the
  // dropdown does not disable the current tier), and the service cancels first
  // precisely so the customer does not end up on two plans. So mid-re-grant the
  // customer legitimately holds two subscriptions, one canceled and one active,
  // and the sync has to choose between them.
  //
  // This is the test that found it choosing wrongly: it used to list with
  // `limit: 1` and cache whatever came back, which assumes the newest-first
  // ordering real Stripe documents. localstripe lists oldest-first, so the
  // canceled predecessor won and the tier read back `Basic` with an active Pro
  // subscription sitting right there in Stripe. `selectCurrentSubscription` now
  // picks on status and recency instead of list order, which is why this asserts
  // the active subscription against a server that lists it last.
  it('caches the new subscription, not the predecessor it cancelled', async () => {
    const userId = createTestUserId('target');
    const caller = createAdminCaller();

    await caller.account.setUserTier({
      userId,
      email: 'target@example.com',
      tier: 'Standard',
      productId: planIds.standardPlanId,
    });
    const regrant = await caller.account.setUserTier({
      userId,
      email: 'target@example.com',
      tier: 'Pro',
      productId: planIds.proPlanId,
    });

    // The grant itself worked: exactly one active subscription, on Pro.
    const customerId = await getStripeCustomerId(userId);
    const active = await getStripe().subscriptions.list({
      customer: String(customerId),
      status: 'active',
      limit: 100,
    });
    expect(active.data).toHaveLength(1);
    expect(active.data[0]?.items.data[0]?.plan.product).toBe(planIds.proPlanId);

    // ...and the cache agrees with it.
    expect(regrant.status).toBe('active');
    expect(
      getSubscriptionType(await getUserSubscriptionFromRedis(userId), planIds),
    ).toBe('Pro');
  });

  // The guard that keeps this procedure off real Stripe is the one branch that
  // cannot be exercised here — the connection is localstripe by construction —
  // so what is asserted is the input contract instead.
  it('rejects an invalid email before touching Stripe', async () => {
    await expect(
      createAdminCaller().account.setUserTier({
        userId: createTestUserId('target'),
        email: 'not-an-email',
        tier: 'Standard',
        productId: planIds.standardPlanId,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('refuses a paid tier with no product to put it on', async () => {
    await expect(
      createAdminCaller().account.setUserTier({
        userId: createTestUserId('target'),
        email: 'target@example.com',
        tier: 'Standard',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
