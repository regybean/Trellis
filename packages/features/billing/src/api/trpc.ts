import { createDb } from '@acme/db';
import { createFeatureTRPCWithDb } from '@acme/trpc';

const _db = createDb();

export const db = _db;
export type db = typeof _db;

export const {
  createTRPCContext,
  createTRPCRouter,
  createCallerFactory,
  protectedProcedure,
  adminProcedure,
  requireTier,
} = createFeatureTRPCWithDb(_db);
