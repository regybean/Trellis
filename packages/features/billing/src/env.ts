import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod/v4';

import { jsonEnv, readEnv, resolveAppEnv, withProfiles } from '@acme/env';

import type { BillingConfigValues } from './config-context';
import { BILLING_DEVELOPMENT_PROFILE } from './development-profile';

/** The deploy-target selector, resolved at this slice's `process.env` edge. */
const appEnv = resolveAppEnv(process.env.APP_ENV);

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
 * object-strip).
 */
export const stripeConnectionSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('localstripe'), apiBase: z.url() }),
  z.object({ mode: z.literal('real') }),
]);

/** The narrowed Stripe connection a server consumer receives. */
export type StripeConnection = z.output<typeof stripeConnectionSchema>;

/**
 * Billing's environment, declared once (ADR 0033) — the slice's browser-safe
 * values, its server-only values and its secrets in one `createEnv` call,
 * composed into an app's env graph via `extends: [billingEnv(), …]`.
 *
 * **`shared`** — browser-safe and read on both sides: the plan/product ids, the
 * (publishable, not secret) Stripe key and the billing-portal URL. They are
 * threaded through `BillingConfigProvider` / `useBillingConfig`, and — for the
 * product→tier mapping — through `createSubscriptionsEntitlements(toPlanIds(env))`.
 * `shared` rather than `client` because t3-env requires the `NEXT_PUBLIC_` prefix
 * on `client` keys, and that prefix would be a lie on an authored value.
 *
 * **`server`** — read only at billing's server edges (`stripe-client.ts`,
 * `stripe-checkout.ts`, `scripts/seed-localstripe.ts`):
 * - `STRIPE_CONNECTION`: the localstripe-vs-real connection, overridable as one
 *   JSON document (`jsonEnv`) so a half-configured connection stays
 *   unrepresentable. `localstripeMode` derives from it.
 * - the checkout redirect paths: app- and env-invariant path+query. Only the
 *   *origin* varies per app, and that is threaded in at the app edge.
 * - `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`: the two secrets. The
 *   development profile authors localstripe's fixed placeholders — documented as
 *   not real secrets and gitleaks-allowlisted (ADR 0004) — so a clean checkout
 *   runs billing against the fake server with no `.env` rows; the
 *   staging/production overlays **unauthor** them, which makes them demanded
 *   secrets on those targets by the same mechanical rule as every other secret.
 *
 * Every key is in `runtimeEnv`, so every key is env-overridable (ADR 0033 §4) —
 * which for this slice is the difference between "point a deploy at a different
 * Stripe account" and "edit a profile, commit, rebuild the image". Override
 * reaches the *server*; a browser resolves `shared` keys from the authored
 * profile, because a browser has no environment to be overridden from.
 */
export function billingEnv() {
  return createEnv({
    clientPrefix: 'NEXT_PUBLIC_',
    client: {},
    shared: {
      NODE_ENV: z.enum(['development', 'production', 'test']),
      STRIPE_STANDARD_PLAN_ID: z.string().nonempty(),
      STRIPE_PRO_PLAN_ID: z.string().nonempty(),
      STRIPE_PUBLISHABLE_KEY: z.string().nonempty(),
      STRIPE_MANAGE_BILLING_URL: z.url(),
    },
    server: {
      STRIPE_CONNECTION: jsonEnv(stripeConnectionSchema),
      STRIPE_CHECKOUT_SUCCESS_PATH: z.string().nonempty(),
      STRIPE_CHECKOUT_CANCEL_PATH: z.string().nonempty(),
      STRIPE_SECRET_KEY: z.string().nonempty(),
      STRIPE_WEBHOOK_SECRET: z.string().nonempty(),
    },
    createFinalSchema: (shape) =>
      withProfiles(shape, appEnv, {
        default: { ...BILLING_DEVELOPMENT_PROFILE, NODE_ENV: 'development' },
        staging: {
          STRIPE_STANDARD_PLAN_ID: 'prod_T2b3wYAaSPayq9',
          STRIPE_PRO_PLAN_ID: 'prod_T2b3IQlAZbsiAH',
          STRIPE_PUBLISHABLE_KEY:
            'pk_test_51RCceGPMjvKXpTVIC6GbUmud0VtKq0OeQuu5DUuX7KolMPPQKWsQLWxIiZLv0m3nXtcnJYCTl9GTJr45Vfa0vsLV005TSeKEgA',
          STRIPE_MANAGE_BILLING_URL:
            'https://billing.stripe.com/p/login/test_7sYfZjfjG6Ve6W14CU48000',
          STRIPE_CONNECTION: { mode: 'real' },
          STRIPE_SECRET_KEY: undefined,
          STRIPE_WEBHOOK_SECRET: undefined,
        },
        production: {
          STRIPE_STANDARD_PLAN_ID: 'prod_T6IOFQdnQkkQxn',
          STRIPE_PRO_PLAN_ID: 'prod_T6IPb2IkIlxhUQ',
          STRIPE_PUBLISHABLE_KEY:
            'pk_live_51RCce7AuOyPJ7lEcthxkxlqdqFTSijKQo6H2rJosbB2xYKzO6QfaS2BbkMWS2L9nwwxhusIJIvcu2RCSWi0od8Oj00tgu1fwjl',
          STRIPE_MANAGE_BILLING_URL:
            'https://billing.stripe.com/p/login/5kQ7sK6VG0XffTresjdjO00',
          STRIPE_CONNECTION: { mode: 'real' },
          STRIPE_SECRET_KEY: undefined,
          STRIPE_WEBHOOK_SECRET: undefined,
        },
      }),
    runtimeEnv: {
      NODE_ENV: process.env.NODE_ENV,
      STRIPE_STANDARD_PLAN_ID: readEnv('STRIPE_STANDARD_PLAN_ID'),
      STRIPE_PRO_PLAN_ID: readEnv('STRIPE_PRO_PLAN_ID'),
      STRIPE_PUBLISHABLE_KEY: readEnv('STRIPE_PUBLISHABLE_KEY'),
      STRIPE_MANAGE_BILLING_URL: readEnv('STRIPE_MANAGE_BILLING_URL'),
      STRIPE_CONNECTION: readEnv('STRIPE_CONNECTION'),
      STRIPE_CHECKOUT_SUCCESS_PATH: readEnv('STRIPE_CHECKOUT_SUCCESS_PATH'),
      STRIPE_CHECKOUT_CANCEL_PATH: readEnv('STRIPE_CHECKOUT_CANCEL_PATH'),
      STRIPE_SECRET_KEY: readEnv('STRIPE_SECRET_KEY'),
      STRIPE_WEBHOOK_SECRET: readEnv('STRIPE_WEBHOOK_SECRET'),
    },
    emptyStringAsUndefined: true,
  });
}

export const env = billingEnv();

/**
 * The single env→`PlanIds` mapper (ADR 0033). Every edge that needs the
 * product→tier plan ids — the tRPC route, the Clerk context, the generation
 * workers, and `usePricing` — threads its values through here rather than each
 * hand-rolling `{ standardPlanId, proPlanId }` (a data clump). Adding a plan
 * touches this mapper alone. Shape matches `@acme/subscriptions`' `PlanIds`,
 * consumed by `createSubscriptionsEntitlements` / `buildPricingPlans`.
 *
 * It takes its values rather than reading `env` directly because both sides call
 * it: a server edge passes this slice's `env`, and `usePricing` passes what
 * `useBillingConfig` handed the browser through the provider.
 */
export const toPlanIds = (config: BillingConfigValues) => ({
  standardPlanId: config.STRIPE_STANDARD_PLAN_ID,
  proPlanId: config.STRIPE_PRO_PLAN_ID,
});

/**
 * Narrow this slice's env down to its browser-safe keys before it crosses the
 * RSC/Flight boundary into `BillingConfigProvider`. Passing the whole env object
 * as a client-component prop would Flight-serialize the server values into the
 * browser payload (serialization runs on the server, where the access guard
 * can't fire). This picker keeps only the browser-safe keys — the guard's
 * invariant preserved at the seam instead of by splitting the env in two
 * (mirrors `toPlanIds`).
 */
export const toBillingClientConfig = (config: BillingConfigValues) => ({
  STRIPE_STANDARD_PLAN_ID: config.STRIPE_STANDARD_PLAN_ID,
  STRIPE_PRO_PLAN_ID: config.STRIPE_PRO_PLAN_ID,
  STRIPE_PUBLISHABLE_KEY: config.STRIPE_PUBLISHABLE_KEY,
  STRIPE_MANAGE_BILLING_URL: config.STRIPE_MANAGE_BILLING_URL,
});
