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
  tablesFilter: ['acme_*', 'mastra_*'],
  out: './migrations/db',
  casing: 'camelCase',
  verbose: true,
  strict: true,
} satisfies Config;
