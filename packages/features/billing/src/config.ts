import { z } from 'zod/v4';

import type { ConfigContext } from '@acme/config';
import { createConfig } from '@acme/config';

import type { BillingConfigValues } from './config-context';

/**
 * How the Stripe SDK connects — a discriminated union so illegal states are
 * unrepresentable. `apiBase` exists *only* in `localstripe` mode (local dev
 * against the fake stateful Stripe server, ADR 0003/0004); the `real` variant
 * carries no URL at all, so a staging/production build can never hold a stray
 * localhost address.
 *
 * The union is also the overlay-merge safety net: profiles are additive overlays
 * over `default`, so a `staging`/`production` overlay of `{ mode: 'real' }`
 * deep-merges onto the inherited `{ mode: 'localstripe', apiBase }` — and the
 * `real` variant then strips the inherited `apiBase` at parse time (zod
 * object-strip, the same mechanism `modelsConfig` relies on).
 */
export const stripeConnectionSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('localstripe'), apiBase: z.url() }),
  z.object({ mode: z.literal('real') }),
]);

/** The narrowed Stripe connection a server consumer receives. */
export type StripeConnection = z.output<typeof stripeConnectionSchema>;

/**
 * Billing config-as-code (ADR 0026). One slice-owned config carrying both the
 * slice's `client` values (read in the browser) and its `server` values (read
 * only at billing's own server edges) — a single `createConfig`, baked at build
 * from `APP_ENV`. `@acme/config`'s client guard is what keeps the two sides
 * honest: a server key read on the client throws, so both can share one profile
 * set (this merged the former standalone `stripeConnectionConfig` factory back
 * in — see ADR 0026 follow-up).
 *
 * **client** — browser-safe; threaded through `BillingConfigProvider` /
 *   `useBillingConfig`, and — for the product→tier mapping — through
 *   `createSubscriptionsEntitlements(toPlanIds(config))`. The plan/product IDs,
 *   the (publishable, not secret) Stripe key, and the billing-portal URL. The
 *   `NEXT_PUBLIC_` prefix is dropped: it was an env-bundling mechanism, and config
 *   bakes at build regardless.
 * **server** — read at billing's server edges (`stripe-client.ts`,
 *   `stripe-checkout.ts`, `scripts/seed-localstripe.ts`):
 *   - `stripe`: the localstripe-vs-real connection (see `stripeConnectionSchema`).
 *     Replaces the `STRIPE_API_BASE` env switch; the boolean `localstripeMode`
 *     derives from it.
 *   - `checkoutSuccessPath` / `checkoutCancelPath`: the app- and env-invariant
 *     path+query of the Stripe redirect targets. Only the **origin** varied per
 *     app, so origin is threaded in at the app edge and combined with these paths.
 *
 * The app composes this with `configExtends`, but must thread only the client
 * subset across the RSC/Flight boundary into `BillingConfigProvider` — see
 * `toBillingClientConfig`. Only the Stripe **secrets** (`STRIPE_SECRET_KEY`,
 * `STRIPE_WEBHOOK_SECRET`) remain in `process.env`.
 */
export function billingConfig(context: ConfigContext) {
  return createConfig({
    client: {
      STRIPE_STANDARD_PLAN_ID: z.string(),
      STRIPE_PRO_PLAN_ID: z.string(),
      STRIPE_PUBLISHABLE_KEY: z.string(),
      STRIPE_MANAGE_BILLING_URL: z.url(),
    },
    server: {
      stripe: stripeConnectionSchema,
      checkoutSuccessPath: z.string(),
      checkoutCancelPath: z.string(),
    },
    profiles: {
      default: {
        client: {
          STRIPE_STANDARD_PLAN_ID: 'prod_dev_standard',
          STRIPE_PRO_PLAN_ID: 'prod_dev_pro',
          STRIPE_PUBLISHABLE_KEY: 'pk_test_localstripe',
          STRIPE_MANAGE_BILLING_URL: 'http://localhost:3000/billing',
        },
        server: {
          stripe: { mode: 'localstripe', apiBase: 'http://localhost:8420' },
          checkoutSuccessPath: '/billing?success=true',
          checkoutCancelPath: '/billing?canceled=true',
        },
      },
      staging: {
        client: {
          STRIPE_STANDARD_PLAN_ID: 'prod_T2b3wYAaSPayq9',
          STRIPE_PRO_PLAN_ID: 'prod_T2b3IQlAZbsiAH',
          STRIPE_PUBLISHABLE_KEY:
            'pk_test_51RCceGPMjvKXpTVIC6GbUmud0VtKq0OeQuu5DUuX7KolMPPQKWsQLWxIiZLv0m3nXtcnJYCTl9GTJr45Vfa0vsLV005TSeKEgA',
          STRIPE_MANAGE_BILLING_URL:
            'https://billing.stripe.com/p/login/test_7sYfZjfjG6Ve6W14CU48000',
        },
        server: { stripe: { mode: 'real' } },
      },
      production: {
        client: {
          STRIPE_STANDARD_PLAN_ID: 'prod_T6IOFQdnQkkQxn',
          STRIPE_PRO_PLAN_ID: 'prod_T6IPb2IkIlxhUQ',
          STRIPE_PUBLISHABLE_KEY:
            'pk_live_51RCce7AuOyPJ7lEcthxkxlqdqFTSijKQo6H2rJosbB2xYKzO6QfaS2BbkMWS2L9nwwxhusIJIvcu2RCSWi0od8Oj00tgu1fwjl',
          STRIPE_MANAGE_BILLING_URL:
            'https://billing.stripe.com/p/login/5kQ7sK6VG0XffTresjdjO00',
        },
        server: { stripe: { mode: 'real' } },
      },
    },
    context,
  });
}

/**
 * The single config→`PlanIds` mapper (ADR 0026). Every edge that needs the
 * product→tier plan IDs — the tRPC route, the Clerk context, the generation
 * workers, and `usePricing` — resolves the composed `billingConfig` and threads
 * it through here, rather than each hand-rolling `{ standardPlanId, proPlanId }`
 * (a data clump). Adding a plan touches this mapper alone. Shape matches
 * `@acme/subscriptions`' `PlanIds`, consumed by `createSubscriptionsEntitlements`
 * / `buildPricingPlans`.
 */
export const toPlanIds = (config: BillingConfigValues) => ({
  standardPlanId: config.STRIPE_STANDARD_PLAN_ID,
  proPlanId: config.STRIPE_PRO_PLAN_ID,
});

/**
 * Narrow a composed config down to billing's client keys before it crosses the
 * RSC/Flight boundary into `BillingConfigProvider`. `billingConfig` carries
 * server keys too now, and the app composes everything with `configExtends`;
 * passing that whole guarded object as a client-component prop would
 * Flight-serialize the server values into the browser payload (serialization runs
 * on the server, where the client guard can't fire). This picker keeps only the
 * browser-safe keys — the client-guard invariant preserved at the seam instead of
 * by splitting the config in two (mirrors `toPlanIds`).
 */
export const toBillingClientConfig = (config: BillingConfigValues) => ({
  STRIPE_STANDARD_PLAN_ID: config.STRIPE_STANDARD_PLAN_ID,
  STRIPE_PRO_PLAN_ID: config.STRIPE_PRO_PLAN_ID,
  STRIPE_PUBLISHABLE_KEY: config.STRIPE_PUBLISHABLE_KEY,
  STRIPE_MANAGE_BILLING_URL: config.STRIPE_MANAGE_BILLING_URL,
});
