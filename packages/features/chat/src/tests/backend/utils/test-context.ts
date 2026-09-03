/**
 * Test Context — chat.
 *
 * The tRPC caller context comes from the one canonical builder
 * (`@acme/trpc/testing`); this file only owns chat's data cleanup. Chat persists
 * Conversations via Mastra Memory (the `mastra_*` tables) and uses the isolated
 * Redis DB.
 */

import type { TestEntitlementsOptions } from '@acme/entitlements/testing';
import type { InjectedUser } from '@acme/trpc';
import type { FeatureTestContextOptions } from '@acme/trpc/testing';
import { createMockEntitlements } from '@acme/entitlements/testing';
import { mastraMessages, mastraThreads } from '@acme/rag/schema';
import { flushTestDb } from '@acme/redis/testing';
import {
  createTestContext as createBaseTestContext,
  createMockSession,
} from '@acme/trpc/testing';

import { db } from '../../../api/trpc';

/**
 * The knobs chat's backend tests vary: the principal, plus the tier and credits
 * its mock provider resolves to — chat meters credits, so `ChatContext` names an
 * entitlements provider and these knobs are what a test sets it to (#256).
 */
export interface TestContextOptions
  extends FeatureTestContextOptions, TestEntitlementsOptions {}

/**
 * Build the tRPC caller context. The one canonical builder lives in
 * `@acme/trpc/testing`; this wrapper turns chat's `userId`/`role` knobs into the
 * `InjectedUser` principal it wants — identity and role, nothing more — and
 * supplies `ChatContext`'s entitlements provider, the way an app edge supplies
 * the real one.
 */
export function createTestContext({
  userId,
  role,
  ...entitlements
}: TestContextOptions) {
  const user: InjectedUser = { id: userId, role };
  return createBaseTestContext({
    session: createMockSession(user),
    entitlements: createMockEntitlements(entitlements),
  });
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
