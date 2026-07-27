import { z } from 'zod/v4';

import type { ConfigContext } from '@acme/config';
import { createConfig } from '@acme/config';

import type { BillingClientConfig } from './config-context';

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
 * Stays in `process.env`: the Stripe **secrets** (`STRIPE_SECRET_KEY`,
 * `STRIPE_WEBHOOK_SECRET`), the dev-only localstripe switch `STRIPE_API_BASE`
 * (a pre-composition infra flag read by the SDK singleton + seed script), and
 * the server checkout redirect URLs `STRIPE_SUCCESS_URL`/`STRIPE_CANCEL_URL`
 * (server-only, injected per deploy, no committed staging/production values).
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
export const toPlanIds = (config: BillingClientConfig) => ({
  standardPlanId: config.STRIPE_STANDARD_PLAN_ID,
  proPlanId: config.STRIPE_PRO_PLAN_ID,
});
