/**
 * What this slice supplies to provision the local `postgres` service, for
 * `@acme/workspace-graph` to discover through this package's
 * `acme.provisioning` — the contract is stated in that package's
 * `src/provisioning.ts`.
 *
 * The values come from the **authored** development profile and never
 * `process.env`: this decides what compose PROVISIONS, so an operator's
 * override would be circular — `scripts/compose.sh` exports the resolved values
 * back into the environment ([@acme/env ADR 0001](../../env/docs/adr/0001-one-env-factory-per-slice.md) §6). Overriding `DB_NAME`
 * therefore points a *connection* at a different database; it does not rename
 * the one compose provisions.
 */
import { DB_DEVELOPMENT_PROFILE } from './development-profile';

export const PROVISIONING = {
  postgres: {
    compose: {
      DB_PORT: DB_DEVELOPMENT_PROFILE.DB_PORT,
      DB_USER: DB_DEVELOPMENT_PROFILE.DB_USER,
      DB_NAME: DB_DEVELOPMENT_PROFILE.DB_NAME,
    },
  },
};
