import type { Config } from 'drizzle-kit';

import { DRIZZLE_CASING } from '@acme/db';
import { env } from '@acme/db/env';

export default {
  dialect: 'postgresql',
  schema: './src/server/db/schema.ts',
  // Connection is authored config (ADR 0033): `@acme/db/env` resolves the profile
  // defaults + the runtime host/port override drizzle-kit push needs.
  dbCredentials: {
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    ssl: false,
  },
  // Mastra namespaces its tables under a per-app schema (NEXT_PUBLIC_WEBAPP).
  schemaFilter: [process.env.NEXT_PUBLIC_WEBAPP ?? 'tanstack_slim'],
  tablesFilter: ['*'],
  out: './migrations/db',
  // Shared with `createDb()` rather than repeated here: drizzle-kit writes the
  // DDL from this and drizzle-orm writes the queries from the same constant, so
  // the two cannot drift into naming columns differently. See @acme/db/casing.
  casing: DRIZZLE_CASING,
  verbose: true,
  strict: true,
} satisfies Config;
