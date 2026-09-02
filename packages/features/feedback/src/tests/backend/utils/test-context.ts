/**
 * Test Context — feedback.
 *
 * The tRPC caller context comes from the one canonical builder
 * (`@acme/trpc/testing`); this file only owns feedback's data cleanup: the
 * app-owned `message_feedback` table, the Mastra tables it annotates, and the
 * isolated Redis DB.
 */

import type { InjectedUser } from '@acme/trpc';
import type { FeatureTestContextOptions } from '@acme/trpc/testing';
import { mastraMessages, mastraThreads } from '@acme/rag/schema';
import { flushTestDb } from '@acme/redis/testing';
import {
  createTestContext as createBaseTestContext,
  createMockSession,
} from '@acme/trpc/testing';

import { messageFeedback } from '../../../api/schemas/feedback-schema';
import { db } from '../../../api/trpc';

/**
 * The knobs feedback's backend tests vary: the principal, and nothing else.
 * Feedback declares no context extension — it has no tier to gate on and no
 * credit to spend — so it sets no tier or credit balance either (#256).
 */
export type TestContextOptions = FeatureTestContextOptions;

/**
 * Build the tRPC caller context. The one canonical builder lives in
 * `@acme/trpc/testing`; this wrapper turns feedback's `userId`/`role` knobs into the
 * `InjectedUser` principal it wants — identity and role, nothing more.
 */
export function createTestContext({ userId, role }: TestContextOptions) {
  const user: InjectedUser = { id: userId, role };
  return createBaseTestContext({ session: createMockSession(user) });
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
