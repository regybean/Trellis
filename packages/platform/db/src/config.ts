import { z } from 'zod/v4';

import type { ConfigContext } from '@acme/config';
import { createConfig } from '@acme/config';

/**
 * DB connection config-as-code (ADR 0026, Option 1). The non-secret connection
 * fields are authored here per deploy target; `env.ts` layers a runtime
 * `process.env` override on top for the host/port, because a testcontainer hands
 * back a *dynamic* mapped port (and an infra-injected prod endpoint is likewise
 * runtime data) that static config cannot know. `DB_PASSWORD` stays a secret in
 * `env.ts`. Server-side — the connection factory runs on the backend.
 *
 * The base (development) values double as the test-container values
 * (`localhost:5432`, `postgres` / `testdb`), so a suite validates against the
 * same profile it connects to.
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
          DB_PORT: 5432,
          DB_USER: 'postgres',
          DB_NAME: 'testdb',
        },
      },
    },
    context,
  });
}
