/**
 * The authored **development** profile for this slice's env, in a module that
 * executes no `createEnv` call.
 *
 * `env.ts` authors its `default` profile from this object, and
 * `scripts/resolve-infra.ts` reads it *without* an environment: the `billing`
 * (localstripe) compose profile is only needed when the *authored* development
 * connection is localstripe, and provisioning wants that authored value rather
 * than an operator's override (ADR 0033 §6).
 *
 * `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` are localstripe's fixed
 * placeholders — documented as not real secrets and gitleaks-allowlisted
 * (ADR 0004) — so a clean checkout runs billing against the fake server with no
 * `.env` rows. Every real deploy target **unauthors** them in `env.ts`, which
 * makes them demanded secrets there.
 */
export const BILLING_DEVELOPMENT_PROFILE = {
  STRIPE_STANDARD_PLAN_ID: 'prod_dev_standard',
  STRIPE_PRO_PLAN_ID: 'prod_dev_pro',
  STRIPE_PUBLISHABLE_KEY: 'pk_test_localstripe',
  STRIPE_MANAGE_BILLING_URL: 'http://localhost:3000/billing',
  STRIPE_CONNECTION: {
    mode: 'localstripe',
    apiBase: 'http://localhost:8420',
  },
  STRIPE_CHECKOUT_SUCCESS_PATH: '/billing?success=true',
  STRIPE_CHECKOUT_CANCEL_PATH: '/billing?canceled=true',
  STRIPE_SECRET_KEY: 'sk_test_localstripe',
  STRIPE_WEBHOOK_SECRET: 'whsec_localstripe',
} as const;
