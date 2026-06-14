import type { Config } from 'drizzle-kit';

export default {
  dialect: 'postgresql',
  schema: './src/server/vdb/schema.ts',
  dbCredentials: {
    host: process.env.DB_HOST!,
    port: parseInt(process.env.DB_PORT!),
    user: process.env.DB_USER!,
    password: process.env.DB_PASSWORD!,
    database: process.env.DB_VECTOR_NAME!,
    ssl: false,
  },
  // Mastra namespaces the knowledge-base table under a per-app schema.
  schemaFilter: [process.env.NEXT_PUBLIC_WEBAPP ?? 'nextjs'],
  tablesFilter: ['*'],
  out: './migrations/vdb',
  casing: 'camelCase',
  verbose: true,
  strict: true,
} satisfies Config;
