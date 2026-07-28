import { z } from 'zod/v4';

import type { ConfigContext } from '@acme/config';
import { createConfig } from '@acme/config';

import type { BillingConfigValues } from './config-context';

/**
 * Billing config-as-code (ADR 0026). The Stripe values that differ per deploy
 * target but are non-sensitive — the plan/product IDs, the (publishable, not
 * secret) client key, and the billing-portal URL — were copy-pasted across every
 * app's `.env.staging`/`.env.production` purely to bake `NEXT_PUBLIC_*` into the
 * client bundle. They collapse here into one slice-owned, app-agnostic profile
 * set, baked at build from `APP_ENV`. The `NEXT_PUBLIC_` prefix is dropped: it
 * was an env-bundling mechanism, and config bakes at build regardless.
 *
 * All four are **client** values (read in the browser: pricing cards, the admin
 * checkout test, the billing-portal link). Consumers read them through
 * `BillingConfigProvider` / `useBillingConfig` (client) and — for the server-side
 * product→tier mapping — through `createSubscriptionsEntitlements(planIds)`,
 * both fed the composed config once at the app's edge.
 *
 * The slice's **server** config-as-code lives in `stripeConnectionConfig` below
 * (a slice may own both a client and a server config; ADR 0026 follow-up). Only
 * the Stripe **secrets** (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`) remain in
 * `process.env`.
 */
export function billingConfig(context: ConfigContext) {
  return createConfig({
    client: {
      STRIPE_STANDARD_PLAN_ID: z.string(),
      STRIPE_PRO_PLAN_ID: z.string(),
      STRIPE_PUBLISHABLE_KEY: z.string(),
      STRIPE_MANAGE_BILLING_URL: z.url(),
    },
    profiles: {
      default: {
        client: {
          STRIPE_STANDARD_PLAN_ID: 'prod_dev_standard',
          STRIPE_PRO_PLAN_ID: 'prod_dev_pro',
          STRIPE_PUBLISHABLE_KEY: 'pk_test_localstripe',
          STRIPE_MANAGE_BILLING_URL: 'http://localhost:3000/billing',
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
 * How the Stripe SDK connects — a discriminated union so illegal states are
 * unrepresentable (ADR 0026 follow-up). `apiBase` exists *only* in `localstripe`
 * mode (local dev against the fake stateful Stripe server, ADR 0003/0004); the
 * `real` variant carries no URL at all, so a staging/production build can never
 * hold a stray localhost address.
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
 * Billing's **server** config-as-code (ADR 0026 follow-up): the last non-secret
 * Stripe values that were env carve-outs.
 *
 * - `stripe`: the localstripe-vs-real connection (see `stripeConnectionSchema`).
 *   Replaces the `STRIPE_API_BASE` env switch; the localstripe infra profile and
 *   the boolean `localstripeMode` both derive from it.
 * - `checkoutSuccessPath` / `checkoutCancelPath`: the app- and env-invariant
 *   path+query of the Stripe redirect targets. Only the **origin** varied per app
 *   (`localhost:3000` vs `3001`, prod domains), so origin is threaded in at the
 *   app edge and combined with these paths when building the absolute URL —
 *   replacing the per-app `STRIPE_SUCCESS_URL`/`STRIPE_CANCEL_URL` env rows.
 *
 * All-server, so it must NOT sit on `billingConfig` (the client config, threaded
 * wholesale across the RSC boundary — any server key there would bake into the
 * browser bundle). Resolved at billing's own env edge, mirroring
 * `ingestConfig`/`s3-client.ts`.
 */
export function stripeConnectionConfig(context: ConfigContext) {
  return createConfig({
    server: {
      stripe: stripeConnectionSchema,
      checkoutSuccessPath: z.string(),
      checkoutCancelPath: z.string(),
    },
    profiles: {
      default: {
        server: {
          stripe: { mode: 'localstripe', apiBase: 'http://localhost:8420' },
          checkoutSuccessPath: '/billing?success=true',
          checkoutCancelPath: '/billing?canceled=true',
        },
      },
      staging: { server: { stripe: { mode: 'real' } } },
      production: { server: { stripe: { mode: 'real' } } },
    },
    context,
  });
}
