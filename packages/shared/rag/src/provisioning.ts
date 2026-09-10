/**
 * What this slice supplies to provision the local `postgres` service — the
 * vector database created beside the app's own — for `@acme/workspace-graph` to
 * discover through this package's `acme.provisioning`; the contract is stated in
 * that package's `src/provisioning.ts`.
 *
 * The name comes from the **authored** development profile and never
 * `process.env`: this decides what compose PROVISIONS, so an operator's
 * override would be circular. Overriding `DB_VECTOR_NAME` therefore points a
 * *connection* at a different database; it does not rename the one compose
 * creates.
 */
import { RAG_DEVELOPMENT_PROFILE } from './development-profile';

export const PROVISIONING = {
  postgres: {
    compose: { DB_VECTOR_NAME: RAG_DEVELOPMENT_PROFILE.DB_VECTOR_NAME },
  },
};
