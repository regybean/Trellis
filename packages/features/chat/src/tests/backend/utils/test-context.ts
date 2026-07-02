/**
 * Test Context — chat.
 *
 * The tRPC caller context comes from the one canonical builder
 * (`@acme/trpc/testing`); this file only owns chat's data cleanup. Chat persists
 * Conversations via Mastra Memory (the `mastra_*` tables) and uses the isolated
 * Redis DB.
 */

import { mastraMessages, mastraThreads } from '@acme/rag/schema';
import { flushTestDb } from '@acme/redis/testing';

import { db } from '../../../api/trpc';

export { createTestContext } from '@acme/trpc/testing';
export type { TestContextOptions } from '@acme/trpc/testing';

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
