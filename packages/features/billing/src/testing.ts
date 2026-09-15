/**
 * localstripe test support — the `@acme/billing/testing` export subpath.
 *
 * Two things a suite needs to talk to a real Stripe server, owned here beside
 * the code that talks to it: the container descriptor, and the seed that puts
 * the products and plans in it.
 *
 * Both are env-free on purpose. A suite's `global-setup.ts` imports this module
 * in the main Vitest process, *before* `hydrate-env` has published the
 * container's connection — so importing this slice's `env.ts` here would
 * validate a `STRIPE_CONNECTION` that does not exist yet. The descriptor is
 * plain data, and the seed takes its client and its plan ids as arguments,
 * which is also what lets `scripts/seed-localstripe.ts` and the backend suite
 * seed identically rather than each holding its own copy of the plan table.
 *
 * See docs/adr/0001-localstripe-dev-billing.md.
 */
import type Stripe from 'stripe';

import type { PlanIds } from '@acme/subscriptions';
import type { InfraDescriptor } from '@acme/test-utils/infra';

/**
 * Pinned to match the docker-compose `localstripe` service, so a suite and
 * `pnpm infra:up` exercise the same server.
 */
export const LOCALSTRIPE_IMAGE = 'adrienverge/localstripe:1.15.10';

/**
 * The localstripe container a backend suite starts.
 *
 * Readiness is an **HTTP** wait, not a log one: localstripe writes nothing at
 * startup — only access lines once traffic arrives — so there is no line to
 * wait for. The path is its bundled Stripe.js shim, the one thing it serves
 * unauthenticated; `/` answers 401 and would never look ready. That is the same
 * probe, and the same reasoning, as the compose healthcheck.
 *
 * `provides` contributes only the connection: the SDK's placeholder secrets are
 * authored by this slice's development profile, so the sole dynamic value is
 * the `apiBase` testcontainers assigned. It rides as JSON because
 * `STRIPE_CONNECTION` is a `jsonEnv` union — a half-configured connection stays
 * unrepresentable through the test path too.
 */
export const localstripeContainer: InfraDescriptor = {
  name: 'billing',
  image: LOCALSTRIPE_IMAGE,
  // Container-internal only; testcontainers publishes it to a random host port,
  // so a suite never contends with the dev stack's fixed 8420.
  containerPort: 8420,
  wait: { kind: 'http', path: '/js.stripe.com/v3/' },
  provides: (host, port) => ({
    STRIPE_CONNECTION: JSON.stringify({
      mode: 'localstripe',
      apiBase: `http://${host}:${port}`,
    }),
  }),
};

/**
 * One tier's seeded product + plan.
 *
 * localstripe predates Stripe's Prices API and models the legacy **Plans** API,
 * so a plan is what gets created and `plan.product` is what
 * `getSubscriptionType` later compares against the env plan ids. The product id
 * is therefore not cosmetic: it has to *be* the env value, or the tier resolves
 * to `Basic` no matter what the subscription says.
 */
interface LocalstripePlanSeed {
  productId: string;
  productName: string;
  planId: string;
  /** Pence, mirroring the `pricing-data.ts` display (Standard £30, Pro £80). */
  amount: number;
}

/** The plan table, derived from whichever plan ids the caller is running with. */
export const localstripePlanSeeds = ({
  standardPlanId,
  proPlanId,
}: PlanIds): LocalstripePlanSeed[] => [
  {
    productId: standardPlanId,
    productName: 'Standard',
    planId: 'price_dev_standard',
    amount: 3000,
  },
  {
    productId: proPlanId,
    productName: 'Pro',
    planId: 'price_dev_pro',
    amount: 8000,
  },
];

/**
 * Create the products and plans the app expects, idempotently.
 *
 * Idempotent by retrieve-then-create rather than by a flag, because localstripe
 * keeps its state in memory: a fresh container has nothing, a re-run against a
 * live one has everything, and neither case should be special. Returns the
 * seeds it ensured so a caller can log or assert against them.
 *
 * The webhook registration that `pnpm infra:up` also needs is *not* here — it
 * points at a running app, which a suite has none of.
 */
export async function seedLocalstripePlans(
  stripe: Stripe,
  planIds: PlanIds,
): Promise<LocalstripePlanSeed[]> {
  const seeds = localstripePlanSeeds(planIds);

  for (const seed of seeds) {
    try {
      await stripe.products.retrieve(seed.productId);
    } catch {
      await stripe.products.create({
        id: seed.productId,
        name: seed.productName,
      });
    }

    try {
      await stripe.plans.retrieve(seed.planId);
    } catch {
      await stripe.plans.create({
        id: seed.planId,
        product: seed.productId,
        amount: seed.amount,
        currency: 'gbp',
        interval: 'month',
      });
    }
  }

  return seeds;
}
