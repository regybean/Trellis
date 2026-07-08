/**
 * tRPC test helpers — the ONE canonical source for a backend test context.
 *
 * Shipped as the `@acme/trpc/testing` export subpath so every feature builds its
 * tRPC caller context from the same place, typed against the REAL platform
 * contract (`EntitlementsProvider`, `Entitlements`, `SubscriptionCache`,
 * `SubscriptionTier`, `CreditBalance`) rather than the structural `as any` casts
 * a tooling package was forced into. Prod code never imports this subpath (it is
 * tree-shaken out); only `*.test.ts` and backend `setup.ts` files do.
 *
 * Fidelity: `createTestContext` returns exactly the shape `createTRPCContext`
 * produces (`satisfies BaseContext`), and its `subscription`/`tier`/`credits`
 * are derived from the SAME `resolveEntitlements` the injected mock provider's
 * `resolve()` returns — so a test context can never drift from what the real
 * substrate would assemble for the same entitlements. It is deliberately
 * synchronous (the mock `resolve` is pure) so callers keep a plain
 * `createCaller(opts)` with no `await`.
 */
import type {
  CreditBalance,
  Entitlements,
  EntitlementsProvider,
  SubscriptionCache,
  SubscriptionTier,
} from '@acme/entitlements';
import { isTierAtLeast } from '@acme/entitlements';

import type { createTRPCContext, InjectedAuth } from './index';

/** Knobs a test varies per caller: identity, role, tier, and credit balance. */
export interface TestContextOptions {
  userId: string;
  role: 'admin' | 'user';
  tier: SubscriptionTier;
  credits: CreditBalance;
}

/**
 * The subscription a real `@acme/subscriptions` adapter would resolve for a
 * tier. `Basic` is the canonical no-billing `{ status: 'none' }`; paid tiers get
 * an active, Stripe-shaped record so `requireTier` gating and
 * `subscription.status` reads run against a realistic shape.
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

/** The single derivation shared by the mock provider and the test context. */
function resolveEntitlements(opts: {
  tier: SubscriptionTier;
  credits: CreditBalance;
}): Entitlements {
  return {
    subscription: subscriptionForTier(opts.tier),
    tier: opts.tier,
    credits: opts.credits,
  };
}

/**
 * A mock `EntitlementsProvider`: `resolve` echoes the tier/credits with a
 * tier-faithful subscription, `consume` is a no-op (no Redis), and
 * `isTierAtLeast` is the REAL ordering from `@acme/entitlements` so `requireTier`
 * gates behave exactly as in production.
 */
export function createMockEntitlements(opts: {
  tier: SubscriptionTier;
  credits: CreditBalance;
}) {
  const resolved = resolveEntitlements(opts);
  return {
    resolve: () => Promise.resolve(resolved),
    consume: () => Promise.resolve(),
    isTierAtLeast,
  } satisfies EntitlementsProvider;
}

/**
 * Stubbed session auth in the neutral `InjectedAuth` shape the platform
 * actually consumes (Clerk is resolved in the app adapter, never here) — just
 * enough for `protectedProcedure`/`adminProcedure` to narrow `userId` and read
 * the role claim.
 */
export function createMockAuth(userId: string, role: 'admin' | 'user') {
  return {
    userId,
    sessionClaims: { metadata: { role } },
  } satisfies InjectedAuth;
}

/**
 * A minimal injected user, typed as the augmentable `InjectedUser` seam. The
 * platform reads no user fields (the base is empty), so the runtime object is
 * minimal; the return annotation makes the emitted type adapt per consumer — a
 * feature that augments `InjectedUser` to a Clerk `User` (e.g. billing) sees the
 * richer type without this package importing any Clerk SDK.
 */
export function createMockUser(userId: string): InjectedUser {
  return {
    id: userId,
    emailAddresses: [{ emailAddress: 'test@example.com' }],
    primaryEmailAddress: { emailAddress: 'test@example.com' },
  };
}

/**
 * Build a tRPC caller context for backend tests. Pass it straight to a feature's
 * `appRouter.createCaller(...)`. Stubs auth/user and injects the mock
 * entitlements provider; real DB/Redis come from the feature's own `db`/`redis`
 * clients (validated against the running containers — never mocked). Telemetry
 * is ambient (ADR 0023) — there is no span in a caller test, so the ambient
 * helpers noop, and nothing needs stubbing here.
 */
export function createTestContext(
  opts: TestContextOptions,
): Awaited<ReturnType<typeof createTRPCContext>> {
  const { subscription, tier, credits } = resolveEntitlements(opts);
  return {
    headers: new Headers(),
    auth: createMockAuth(opts.userId, opts.role),
    user: createMockUser(opts.userId),
    entitlements: createMockEntitlements(opts),
    subscription,
    tier,
    credits,
  };
}
