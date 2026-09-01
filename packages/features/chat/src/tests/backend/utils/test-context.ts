/**
 * Test Context — chat.
 *
 * The tRPC caller context comes from the one canonical builder
 * (`@acme/trpc/testing`); this file only owns chat's data cleanup. Chat persists
 * Conversations via Mastra Memory (the `mastra_*` tables) and uses the isolated
 * Redis DB.
 */

import type { FeatureTestContextOptions } from '@acme/trpc/testing';
import { mastraMessages, mastraThreads } from '@acme/rag/schema';
import { flushTestDb } from '@acme/redis/testing';
import { createTestContext as createBaseTestContext } from '@acme/trpc/testing';

import { db } from '../../../api/trpc';

/**
 * The knobs chat's backend tests vary. Identical for every feature; only the
 * principal differs, which is why building it is the feature's job.
 */
export type TestContextOptions = FeatureTestContextOptions;

/**
 * Build the tRPC caller context. The one canonical builder lives in
 * `@acme/trpc/testing`; this wrapper supplies the `InjectedUser` chat's own
 * program declares — the platform base, `id` + `role`, and nothing more.
 */
export function createTestContext({
  userId,
  role,
  ...entitlements
}: TestContextOptions) {
  return createBaseTestContext({ user: { id: userId, role }, ...entitlements });
}

/**
 * Remove all test data: Mastra messages before threads (FK order), then flush
 * the isolated Redis DB. The Mastra tables are created lazily on first use, so
 * the delete may run before they exist — ignored.
 */
export async function cleanupTestData() {
  try {
    await db.delete(mastraMessages);
    await db.delete(mastraThreads);
  } catch {
    // Mastra tables are created lazily; nothing to clean if absent.
  }

  await flushTestDb();
}
