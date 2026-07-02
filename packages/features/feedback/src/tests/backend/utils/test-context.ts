/**
 * Test Context — feedback.
 *
 * The tRPC caller context comes from the one canonical builder
 * (`@acme/trpc/testing`); this file only owns feedback's data cleanup: the
 * app-owned `message_feedback` table, the Mastra tables it annotates, and the
 * isolated Redis DB.
 */

import { mastraMessages, mastraThreads } from '@acme/rag/schema';
import { flushTestDb } from '@acme/redis/testing';

import { messageFeedback } from '../../../api/schemas/feedback-schema';
import { db } from '../../../api/trpc';

export { createTestContext } from '@acme/trpc/testing';
export type { TestContextOptions } from '@acme/trpc/testing';

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
