/**
 * Test Context Factory
 *
 * Creates a test context that matches the structure expected by tRPC procedures.
 * - Stubs Clerk auth (don't test Clerk itself)
 * - Uses real Redis connection from the app
 * - Provides noop telemetry (no spans in tests)
 * - Accepts options to simulate different auth and subscription states
 */

import type { TestContextOptions } from '@acme/test-utils';
import { redis } from '@acme/redis';
import {
  createMockAuth,
  createMockUser,
  createNoopTelemetry,
} from '@acme/test-utils';

import type { createTRPCContext } from '../../../api/trpc';

// Type for the tRPC context
type TRPCContext = Awaited<ReturnType<typeof createTRPCContext>>;

export function createTestContext(opts: TestContextOptions): TRPCContext {
  const mockAuth = createMockAuth(opts.userId, opts.role);
  const mockUser = opts.userId ? createMockUser(opts.userId) : null;

  // Create subscription based on tier
  const periodStart = Math.floor(Date.now() / 1000);
  const periodEnd = periodStart + 86_400 * 30; // 30 days from now

  const subscription =
    opts.tier === 'Basic'
      ? {
          status: 'none' as const,
          subscriptionId: null,
          product: null,
          priceId: null,
          currentPeriodStart: null,
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
          paymentMethod: null,
        }
      : {
          status: 'active' as const,
          subscriptionId: 'test-sub-id',
          product:
            opts.tier === 'Standard' ? 'prod_standard_12345' : 'prod_pro_12345',
          priceId:
            opts.tier === 'Standard'
              ? 'price_standard_12345'
              : 'price_pro_12345',
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: false,
          paymentMethod: null,
        };

  return {
    headers: new Headers(),
    auth: mockAuth,
    user: mockUser,
    subscription,
    tier: opts.tier,
    credits: opts.credits,
    telemetry: createNoopTelemetry(),
  };
}

/**
 * Clean up all test data from Redis.
 * Call this in beforeEach/afterEach to ensure test isolation.
 */
export async function cleanupTestData() {
  // Flush test keys from Redis
  try {
    if (!redis.isOpen) {
      await redis.connect();
    }
    await redis.flushDb();
  } catch {
    // Redis might not be connected in all test scenarios
  }
}
