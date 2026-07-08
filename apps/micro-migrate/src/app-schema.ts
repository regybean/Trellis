/* eslint-disable no-restricted-properties */
import { pgSchema } from 'drizzle-orm/pg-core';

// The shared deployment Postgres schema, exported so drizzle-kit emits
// `CREATE SCHEMA` and owns its creation. Every service in the microservices
// showcase connects to this ONE schema (NEXT_PUBLIC_WEBAPP is deployment-wide,
// not per-service — ADR 0023). The name matches the `schemaFilter` fallback in
// the drizzle configs so push and the schema object resolve to the same schema.
export const appSchema = pgSchema(
  process.env.NEXT_PUBLIC_WEBAPP ?? 'trellis_micro',
);
