/**
 * What this slice supplies to provision the local `redis` service, for
 * `@acme/workspace-graph` to discover through this package's
 * `acme.provisioning` — the contract is stated in that package's
 * `src/provisioning.ts`.
 *
 * The DSN comes from the **authored** development profile and never
 * `process.env`: this decides what compose PROVISIONS, so an operator's
 * override would be circular ([@acme/env ADR 0001](../../env/docs/adr/0001-one-env-factory-per-slice.md) §6).
 */
import { REDIS_DEVELOPMENT_PROFILE } from './development-profile';

export const PROVISIONING = {
  redis: {
    compose: {
      // Parsed back out of the DSN that carries it rather than stored beside
      // it — a second field would be a drift source.
      REDIS_PORT: new URL(REDIS_DEVELOPMENT_PROFILE.REDIS_URL).port,
    },
  },
};
