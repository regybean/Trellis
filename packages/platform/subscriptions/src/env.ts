import { resolveAppEnv } from '@acme/config';

/**
 * The config-as-code deploy-target selector (ADR 0026), resolved at this slice's
 * sanctioned `process.env` edge and threaded into `subscriptionsConfig` where the
 * slice builds its config server-side (`credit-policy.ts`). Mirrors the app's
 * `env.ts` read; keeps `config.ts` pure.
 *
 * The Stripe plan-id env this file used to declare moved to `@acme/billing`'s
 * `billingConfig` (Phase 1 dedup); `subscriptions.ts` now takes those ids as an
 * injected `PlanIds` rather than reading them here.
 */
export const appEnv = resolveAppEnv(process.env.APP_ENV);
