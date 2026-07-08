import type { Config } from 'drizzle-kit';

// Migrator drizzle config for the microservices showcase. Points at the shared
// schema module (appSchema + the app-owned feature tables) so `db:push` owns
// their DDL. `schemaFilter` scopes introspection to the shared deployment
// namespace (NEXT_PUBLIC_WEBAPP) — one value across every service (ADR 0023).
export default {
  dialect: 'postgresql',
  schema: './src/schema.ts',
  dbCredentials: {
    host: process.env.DB_HOST!,
    port: parseInt(process.env.DB_PORT!),
    user: process.env.DB_USER!,
    password: process.env.DB_PASSWORD!,
    database: process.env.DB_NAME!,
    ssl: false,
  },
  schemaFilter: [process.env.NEXT_PUBLIC_WEBAPP ?? 'trellis_micro'],
  tablesFilter: ['*'],
  out: './migrations/db',
  casing: 'camelCase',
  verbose: true,
  strict: true,
} satisfies Config;
