import { serverConfigContext } from '@acme/config';

/**
 * The config-as-code deploy-target selector (ADR 0026), resolved at this slice's
 * sanctioned `process.env` edge and threaded into `subscriptionsConfig` where the
 * slice builds its config server-side (`credit-policy.ts`). Mirrors the app's
 * `env.ts` read; keeps `config.ts` pure.
 *
 * The Stripe plan-id env this file used to declare moved to `@acme/billing`'s
 * `billingConfig` (Phase 1 dedup); `subscriptions.ts` now takes those ids as an
 * injected `PlanIds` rather than reading them here.
 *
 * The same edge samples the **override** bag (ADR 0033): every one of this
 * slice's config values can be retuned by a same-name environment variable at
 * runtime, so nothing here has to be re-authored per deploy.
 */
export const configContext = serverConfigContext(process.env);
