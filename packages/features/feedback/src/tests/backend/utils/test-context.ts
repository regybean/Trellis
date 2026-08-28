/**
 * Test Context — feedback.
 *
 * The tRPC caller context comes from the one canonical builder
 * (`@acme/trpc/testing`); this file only owns feedback's data cleanup: the
 * app-owned `message_feedback` table, the Mastra tables it annotates, and the
 * isolated Redis DB.
 */

import type { FeatureTestContextOptions } from '@acme/trpc/testing';
import { mastraMessages, mastraThreads } from '@acme/rag/schema';
import { flushTestDb } from '@acme/redis/testing';
import { createTestContext as createBaseTestContext } from '@acme/trpc/testing';

import { messageFeedback } from '../../../api/schemas/feedback-schema';
import { db } from '../../../api/trpc';

/**
 * The knobs feedback's backend tests vary. Identical for every feature; only the
 * principal differs, which is why building it is the feature's job.
 */
export type TestContextOptions = FeatureTestContextOptions;

/**
 * Build the tRPC caller context. The one canonical builder lives in
 * `@acme/trpc/testing`; this wrapper supplies the `InjectedUser` feedback's own
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
 * Remove all test data: app-owned feedback first, then the Mastra tables
 * (messages before threads), then flush the isolated Redis DB.
 */
export async function cleanupTestData() {
  try {
    await db.delete(messageFeedback);
  } catch {
    // Table might not exist yet — nothing to clean.
  }

  try {
    await db.delete(mastraMessages);
    await db.delete(mastraThreads);
  } catch {
    // Mastra tables are created lazily; ignore if absent.
  }

  await flushTestDb();
}
