/**
 * The authored **development** profile for this slice's env, in a module that
 * executes no `createEnv` call.
 *
 * `env.ts` authors its `default` profile from this object, and two paths read it
 * *without* an environment: `testing.ts` (the testcontainer descriptor) and
 * `scripts/resolve-compose-env.ts` (the compose stack, whose output `compose.sh`
 * exports back into the environment — reading an override there would be
 * circular). Both **provision** the local database rather than connect to someone
 * else's, so they want the values this file authors and never an operator's
 * override (@acme/env ADR 0001 §6). Overriding `DB_NAME` therefore points a *connection* at
 * a different database; it does not rename the one compose provisions.
 *
 * `DB_PASSWORD` is deliberately absent: it is the one DB key with no profile
 * value, so it is a secret on every target (locally `deploy/.env` supplies the
 * container's throwaway).
 *
 * Separate from `env.ts` because importing that module *evaluates* the slice's
 * env — a provisioning script would then have to satisfy every key (including
 * other slices' selectors) just to read a port.
 */

/**
 * Host port the local compose stack publishes Postgres on, and the port a local
 * (non-testcontainers) backend suite probes.
 *
 * Deliberately *not* 5432: the container publishes to a fixed host port, so the
 * default collides with any other project running Postgres on this machine — dev
 * then authenticates against a stranger's database and fails with a bare
 * `password authentication failed for user "postgres"`. 5444 stays in the
 * Postgres family, is below the ephemeral range (49152+) so an outbound socket
 * can't claim it first, and isn't a default anything else reaches for.
 * Container-internal it's still 5432 (see `deploy/compose.yaml`).
 */
export const LOCAL_DB_PORT = 5444;

export const DB_DEVELOPMENT_PROFILE = {
  DB_HOST: 'localhost',
  DB_PORT: LOCAL_DB_PORT,
  DB_USER: 'postgres',
  DB_NAME: 'testdb',
} as const;
