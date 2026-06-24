import type { Config } from 'drizzle-kit';

export default {
  dialect: 'postgresql',
  schema: './src/server/db/schema.ts',
  dbCredentials: {
    host: process.env.DB_HOST!,
    port: parseInt(process.env.DB_PORT!),
    user: process.env.DB_USER!,
    password: process.env.DB_PASSWORD!,
    database: process.env.DB_NAME!,
    ssl: false,
  },
  // Mastra namespaces its tables under a per-app schema (NEXT_PUBLIC_WEBAPP).
  schemaFilter: [process.env.NEXT_PUBLIC_WEBAPP ?? 'nextjs_slim'],
  tablesFilter: ['*'],
  out: './migrations/db',
  casing: 'camelCase',
  verbose: true,
  strict: true,
} satisfies Config;
