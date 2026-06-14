/**
 * Test Context Factory
 *
 * Creates a test context that matches the structure expected by tRPC procedures.
 * - Stubs Clerk auth (don't test Clerk itself)
 * - Uses real DB connection from the app (configured via env.ts)
 * - Uses real Redis connection from the app
 * - Provides noop telemetry (no spans in tests)
 * - Accepts options to simulate different auth states
 */

import type { TestContextOptions } from '@acme/test-utils';
import { mastraMessages, mastraThreads } from '@acme/rag/schema';
import { redis } from '@acme/redis';
import {
  createMockAuth,
  createMockUser,
  createNoopTelemetry,
} from '@acme/test-utils';

import type { createTRPCContext } from '../../../api/trpc';
import { db } from '../../../api/trpc';

// Type for the tRPC context
type TRPCContext = Awaited<ReturnType<typeof createTRPCContext>>;

/**
 * Create a test context for tRPC procedure testing.
 *
 * Uses the real DB and Redis connections from the app, only mocking
 * the auth and telemetry layers for testing purposes.
 */
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
    subscription: defaultSubscription,
    credits: opts.credits,
    tier: opts.tier,
    telemetry: createNoopTelemetry(),
  };
}

/**
 * Clean up all test data from the database and redis.
 * Call this in beforeEach/afterEach to ensure test isolation.
 */
export async function cleanupTestData() {
  // Delete messages before threads. Mastra Memory owns these tables; they are
  // created lazily on first use, so this may run before they exist.
  try {
    await db.delete(mastraMessages);
    await db.delete(mastraThreads);
  } catch (error) {
    // Tables might not exist if migrations haven't been run
    // This is fine for test isolation - if tables don't exist, there's no data to clean
    console.log('⚠️ Cleanup warning:', error);
  }

  // Flush test keys from Redis (use pattern if needed, or flushDb for isolated test DB)
  // Be careful with flushDb in shared environments
  try {
    if (!redis.isOpen) {
      await redis.connect();
    }
    await redis.flushDb();
  } catch {
    // Redis might not be connected in all test scenarios
  }
}
