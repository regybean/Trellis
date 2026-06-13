import { drizzle } from 'drizzle-orm/postgres-js';

import { createFeatureTRPCWithDb } from '@acme/trpc';

import { env } from '../env';

const _db = drizzle({
  connection: {
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
  },
});

export const db = _db;
export type db = typeof _db;

export const {
  createTRPCContext,
  createTRPCRouter,
  createCallerFactory,
  protectedProcedure,
  adminProcedure,
  rateLimit,
} = createFeatureTRPCWithDb(_db);
