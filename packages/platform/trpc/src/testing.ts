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

import type { createTRPCContext, InjectedSession } from './index';

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
 * tier-faithful subscription, `consume` and `refund` are no-ops (no Redis —
 * the real Redis-backed ledger is covered in `@acme/subscriptions`), and
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
    refund: () => Promise.resolve(),
    isTierAtLeast,
  } satisfies EntitlementsProvider;
}

/**
 * A minimal injected principal, typed as the augmentable `InjectedUser` seam.
 * The platform reads only `id` and `role`; the extra `primaryEmailAddress` is
 * there for the consumers that augment the seam with it (billing's Stripe
 * customer lookup). It is built as a plain object rather than an annotated
 * literal deliberately: the platform's own base declares only the two fields it
 * reads, so a literal would be an excess-property error here even though a
 * consumer's augmented view needs the extra one at runtime.
 */
export function createMockUser(
  userId: string,
  role: 'admin' | 'user',
): InjectedUser {
  const user = {
    id: userId,
    role,
    primaryEmailAddress: { emailAddress: 'test@example.com' },
  };
  return user;
}

/**
 * A stubbed session in the neutral `InjectedSession` shape the platform
 * actually consumes (an auth provider is resolved in the app adapter, never
 * here) — just enough for `protectedProcedure` to narrow the principal and
 * `adminProcedure` to read its role.
 */
export function createMockSession(userId: string, role: 'admin' | 'user') {
  return { user: createMockUser(userId, role) } satisfies InjectedSession;
}

/**
 * Build a tRPC caller context for backend tests. Pass it straight to a feature's
 * `appRouter.createCaller(...)`. Stubs the session and injects the mock
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
    // A realistic app origin so procedures that build absolute redirect URLs
    // (billing checkout) resolve one, matching what an app edge would inject.
    origin: 'http://localhost:3000',
    session: createMockSession(opts.userId, opts.role),
    entitlements: createMockEntitlements(opts),
    subscription,
    tier,
    credits,
  };
}
