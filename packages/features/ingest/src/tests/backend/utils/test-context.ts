/**
 * Test Context — ingest.
 *
 * The tRPC caller context comes from the one canonical builder
 * (`@acme/trpc/testing`). Ingest's async pipeline uses an isolated Redis logical
 * DB for the per-user progress stream; `cleanupTestData` flushes it between tests.
 */

import type { FeatureTestContextOptions } from '@acme/trpc/testing';
import { flushTestDb } from '@acme/redis/testing';
import { createTestContext as createBaseTestContext } from '@acme/trpc/testing';

/**
 * The knobs ingest's backend tests vary. Identical for every feature; only the
 * principal differs, which is why building it is the feature's job.
 */
export type TestContextOptions = FeatureTestContextOptions;

/**
 * Build the tRPC caller context. The one canonical builder lives in
 * `@acme/trpc/testing`; this wrapper supplies the `InjectedUser` ingest's own
 * program declares — the platform base, `id` + `role`, and nothing more.
 */
export function createTestContext({
  userId,
  role,
  ...entitlements
}: TestContextOptions) {
  return createBaseTestContext({ user: { id: userId, role }, ...entitlements });
}

/** Flush this suite's isolated Redis DB (the per-user progress streams). */
export async function cleanupTestData() {
  await flushTestDb();
}
