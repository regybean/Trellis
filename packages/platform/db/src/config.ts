import { z } from 'zod/v4';

import type { ConfigContext } from '@acme/config';
import { createConfig } from '@acme/config';

/**
 * Host port the local compose stack publishes Postgres on, and the port a local
 * (non-testcontainers) backend suite probes — `testing.ts` reads this same
 * constant so the two can never drift apart.
 *
 * Deliberately *not* 5432: the container publishes to a fixed host port, so the
 * default collides with any other project running Postgres on this machine —
 * dev then authenticates against a stranger's database and fails with a bare
 * `password authentication failed for user "postgres"`. 5444 stays in the
 * Postgres family, is below the ephemeral range (49152+) so an outbound socket
 * can't claim it first, and isn't a default anything else reaches for.
 * Container-internal it's still 5432 (see `deploy/compose.yaml`).
 */
export const LOCAL_DB_PORT = 5444;

/**
 * DB connection config-as-code (ADR 0026). The non-secret connection fields are
 * authored here per deploy target; `env.ts` layers a runtime `process.env`
 * override on top for the host/port *only*, because a testcontainer hands back a
 * *dynamic* mapped port (and an infra-injected prod endpoint is likewise runtime
 * data) that static config cannot know. `user`/`name` are static per target and
 * stay pure config. `DB_PASSWORD` stays a secret in `env.ts`. Server-side — the
 * connection factory runs on the backend.
 *
 * The base (development) values double as the test-container values
 * (`localhost:${LOCAL_DB_PORT}`, `postgres` / `testdb`), so a suite validates
 * against the same profile it connects to.
 */
export function dbConfig(context: ConfigContext) {
  return createConfig({
    server: {
      DB_HOST: z.string().nonempty(),
      DB_PORT: z.number().int().positive(),
      DB_USER: z.string().nonempty(),
      DB_NAME: z.string().nonempty(),
    },
    profiles: {
      default: {
        server: {
          DB_HOST: 'localhost',
          DB_PORT: LOCAL_DB_PORT,
          DB_USER: 'postgres',
          DB_NAME: 'testdb',
        },
      },
    },
    context,
  });
}
