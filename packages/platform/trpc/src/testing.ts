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
 * produces — session + entitlements provider, and nothing resolved eagerly
 * (#250). The tier and credit knobs still live on `TestContextOptions`, because
 * they are what the injected mock provider resolves *to*: a test sets the tier
 * it wants and the procedure under test reads it through the same
 * `ctx.entitlements.resolve()` production calls.
 */
import type {
  CreditBalance,
  Entitlements,
  EntitlementsProvider,
  SubscriptionCache,
  SubscriptionTier,
} from '@acme/entitlements';
import { isTierAtLeast } from '@acme/entitlements';

import type { createTRPCContext, InjectedSession, Roles } from './index';

/** The billing knobs a test varies per caller. */
export interface TestEntitlementsOptions {
  tier: SubscriptionTier;
  credits: CreditBalance;
}

/**
 * What `createTestContext` needs. The principal arrives whole rather than as
 * `userId` + `role`, because `InjectedUser` is an augmentable global: a feature
 * that adds a field to the seam (billing's primary email) is the only program
 * that can build a complete principal, and building it there is what keeps this
 * platform package free of any one feature's knowledge — and free of the
 * widening it would otherwise take to fake it.
 */
export interface TestContextOptions extends TestEntitlementsOptions {
  user: InjectedUser;
}

/**
 * The knobs a *feature's* own `createTestContext` wrapper exposes to its tests:
 * identity and role, plus the billing knobs. The wrapper turns `userId`/`role`
 * into the feature's own `InjectedUser` — see any feature's
 * `tests/backend/utils/test-context.ts`.
 */
export interface FeatureTestContextOptions extends TestEntitlementsOptions {
  userId: string;
  role: Roles;
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
 * `isTierAtLeast` is the REAL ordering from `@acme/entitlements` so tier gates
 * behave exactly as in production.
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

/**
 * A stubbed session in the neutral `InjectedSession` shape the platform
 * actually consumes (an auth provider is resolved in the app adapter, never
 * here) — just enough for `protectedProcedure` to narrow the principal and
 * `adminProcedure` to read its role.
 */
export function createMockSession(user: InjectedUser) {
  return { user } satisfies InjectedSession;
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
  return {
    headers: new Headers(),
    // A realistic app origin so procedures that build absolute redirect URLs
    // (billing checkout) resolve one, matching what an app edge would inject.
    origin: 'http://localhost:3000',
    session: createMockSession(opts.user),
    entitlements: createMockEntitlements(opts),
  };
}
