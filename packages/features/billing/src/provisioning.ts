/**
 * What this slice says about the local `billing` service (localstripe), for
 * `@acme/workspace-graph` to discover through this package's
 * `acme.provisioning` — the contract is stated in that package's
 * `src/provisioning.ts`.
 *
 * The service is only needed when the **authored** connection is localstripe: a
 * real Stripe connection needs no local container
 * ([ADR 0001](../docs/adr/0001-localstripe-dev-billing.md)). The authored value
 * rather than `process.env`, because this decides what to PROVISION and an
 * operator's override would be the wrong input
 * ([@acme/env ADR 0001](../../../platform/env/docs/adr/0001-one-env-factory-per-slice.md) §6).
 *
 * The seed the service needs is declared in this package's `acme.seeds`, beside
 * the `acme.infra` entry: localstripe holds its products and plans in memory, so
 * every start of the profile re-seeds it.
 */
import { BILLING_DEVELOPMENT_PROFILE } from './development-profile';

/**
 * Read as a value rather than as its authored literal type. The profile is
 * `as const`, so comparing the property directly narrows to `"localstripe" ===
 * "localstripe"` and reads as a dead condition — but the check is on data an
 * overlay is free to change, and it is the whole decision here.
 */
const mode: string = BILLING_DEVELOPMENT_PROFILE.STRIPE_CONNECTION.mode;

export const PROVISIONING = {
  billing: { needed: mode === 'localstripe' },
};
