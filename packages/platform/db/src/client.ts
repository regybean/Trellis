import { drizzle } from 'drizzle-orm/postgres-js';

import { env } from './env';

/**
 * Build a Drizzle (postgres-js) client against the connection in `@acme/db/env`.
 *
 * `database` defaults to the application database (`DB_NAME`); callers that need
 * a different database on the same server pass it explicitly — the one such
 * caller is `@acme/rag`, which connects to the dedicated vector database
 * (`DB_VECTOR_NAME`). This is why there is no separate `vdb` package: a single
 * consumer parameterises the factory instead. See docs/adr/0016.
 *
 * No `schema` is bound: callers query table objects directly (each feature owns
 * its own tables), matching the previous per-feature construction.
 */
export function createDb({
  database = env.DB_NAME,
}: { database?: string } = {}) {
  return drizzle({
    connection: {
      host: env.DB_HOST,
      port: env.DB_PORT,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      database,
    },
  });
}
