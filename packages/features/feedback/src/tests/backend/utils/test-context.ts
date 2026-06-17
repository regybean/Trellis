/**
 * Test Context Factory
 *
 * Builds a tRPC context matching the feedback router's expectations:
 * - Stubs Clerk auth + user (we don't test Clerk itself)
 * - Real DB + Redis connections from the package env
 * - Noop telemetry (no spans in tests)
 */

import type { TestContextOptions } from '@acme/test-utils';
import { mastraMessages, mastraThreads } from '@acme/rag/schema';
import { redis } from '@acme/redis';
import {
  createMockAuth,
  createMockEntitlements,
  createMockUser,
  createNoopTelemetry,
} from '@acme/test-utils';

import type { createTRPCContext } from '../../../api/trpc';
import { messageFeedback } from '../../../api/schemas/feedback-schema';
import { db } from '../../../api/trpc';

type TRPCContext = Awaited<ReturnType<typeof createTRPCContext>>;

export function createTestContext(opts: TestContextOptions): TRPCContext {
  const mockAuth = createMockAuth(opts.userId, opts.role);
  const mockUser = createMockUser(opts.userId);
  const defaultSubscription = {
    status: 'none',
  } as const;

  return {
    headers: new Headers(),
    auth: mockAuth,
    user: mockUser,
    entitlements: createMockEntitlements({
      tier: opts.tier,
      credits: opts.credits,
    }),
    subscription: defaultSubscription,
    credits: opts.credits,
    tier: opts.tier,
    telemetry: createNoopTelemetry(),
  };
}

/**
 * Remove all test data. Deletes app-owned feedback first, then the Mastra
 * tables (messages before threads), then flushes the isolated Redis DB.
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

  try {
    if (!redis.isOpen) {
      await redis.connect();
    }
    await redis.flushDb();
  } catch {
    // Redis might not be connected in all test scenarios.
  }
}
