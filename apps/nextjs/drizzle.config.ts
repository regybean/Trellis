import type { Config } from 'drizzle-kit';

import { env } from '@acme/db/env';

export default {
  dialect: 'postgresql',
  schema: './src/server/db/schema.ts',
  // Connection is config-as-code (ADR 0026): `@acme/db/env` resolves the profile
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
  // `auth` is the deliberate second entry: identity is shared across the apps on
  // one database, so Better Auth's tables sit outside the per-app schema (ADR
  // 0034). Without it here, push would ignore them entirely.
  schemaFilter: [process.env.NEXT_PUBLIC_WEBAPP ?? 'nextjs', 'auth'],
  tablesFilter: ['*'],
  out: './migrations/db',
  casing: 'camelCase',
  verbose: true,
  strict: true,
} satisfies Config;
