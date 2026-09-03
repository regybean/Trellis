/**
 * Test Context — ingest.
 *
 * The tRPC caller context comes from the one canonical builder
 * (`@acme/trpc/testing`). Ingest's async pipeline uses an isolated Redis logical
 * DB for the per-user progress stream; `cleanupTestData` flushes it between tests.
 */

import type { InjectedUser } from '@acme/trpc';
import type { FeatureTestContextOptions } from '@acme/trpc/testing';
import { flushTestDb } from '@acme/redis/testing';
import {
  createTestContext as createBaseTestContext,
  createMockSession,
} from '@acme/trpc/testing';

/**
 * The knobs ingest's backend tests vary: the principal, and nothing else. Ingest
 * context is exactly `BaseContext` — it neither gates on a tier nor spends a credit
 * — so it sets no tier or credit balance either (#256).
 */
export type TestContextOptions = FeatureTestContextOptions;

/**
 * Build the tRPC caller context. The one canonical builder lives in
 * `@acme/trpc/testing`; this wrapper turns ingest's `userId`/`role` knobs into the
 * `InjectedUser` principal it wants — identity and role, nothing more.
 */
export function createTestContext({ userId, role }: TestContextOptions) {
  const user: InjectedUser = { id: userId, role };
  return createBaseTestContext({ session: createMockSession(user) });
}

/** Flush this suite's isolated Redis DB (the per-user progress streams). */
export async function cleanupTestData() {
  await flushTestDb();
}
