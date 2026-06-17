/**
 * Test Mocks
 *
 * Provides common mock implementations for external services.
 * Use vi.mock() in your test setup files to apply these.
 */

import type { auth, User } from '@clerk/nextjs/server';
import type { Span, SpanContext, Tracer } from '@opentelemetry/api';
import type { ZodType } from 'zod';

// ============================================================================
// Credit Info Types
// ============================================================================

/**
 * Credit info type matching the billing package's `credits.read` return type.
 */
export interface CreditInfo {
  remaining: number;
  limit: number;
  resetAt: number;
}
export interface TestContextOptions {
  userId: string;
  role: 'admin' | 'user';
  tier: SubscriptionTier;
  credits: CreditInfo;
}
/**
 * Subscription tier type matching the billing package.
 */
export type SubscriptionTier = 'Basic' | 'Standard' | 'Pro';

/**
 * Subscription cache type for mocking.
 */
export type MockSubscription =
  | { status: 'none' }
  | { status: 'active'; product: string };

// ============================================================================
// Clerk Mock Helpers
// ============================================================================

/**
 * Creates a mock Clerk auth object for authenticated users.
 * Matches the exact shape returned by @clerk/nextjs/server auth().
 *
 * @param userId - The user ID (required - we test authenticated scenarios)
 * @param role - The user role for metadata
 */
export function createMockAuth(
  userId: string,
  role: 'admin' | 'user',
): Awaited<ReturnType<typeof auth>> {
  return {
    userId,
    sessionId: `session_${userId}`,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    sessionClaims: {
      metadata: { role },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    isAuthenticated: true,
    sessionStatus: 'active',
    actor: undefined,
    tokenType: 'session_token',
    debug: () => ({ nothing: 'nothing' }),
    orgId: undefined,
    orgRole: undefined,
    orgSlug: undefined,
    orgPermissions: undefined,
    factorVerificationAge: null,
    getToken: () => Promise.resolve('test-token'),
    has: () => false,
    redirectToSignIn: () => {
      throw new Error('Not implemented in tests');
    },
    redirectToSignUp: () => {
      throw new Error('Not implemented in tests');
    },
  };
}

/**
 * Creates a mock user object for authenticated users.
 * Matches the shape returned by @clerk/nextjs/server currentUser().
 *
 * @param userId - The user ID (required)
 */
export function createMockUser(userId: string): User {
  return {
    id: userId,
    emailAddresses: [{ emailAddress: 'test@example.com' }],
    primaryEmailAddress: { emailAddress: 'test@example.com' },
  } as User;
}

/**
 * Creates default credit info for testing.
 */
export function createDefaultCredits(
  tier: SubscriptionTier = 'Basic',
): CreditInfo {
  const limits: Record<SubscriptionTier, number> = {
    Basic: 100,
    Standard: 500,
    Pro: 1000,
  };
  const limit = limits[tier];
  return {
    remaining: limit,
    limit,
    resetAt: Date.now() + 86_400_000, // 24 hours from now
  };
}

/**
 * Creates a mock entitlements provider for tRPC procedure tests: `consume` is a
 * no-op (no Redis), `isTierAtLeast` uses the real `Basic < Standard < Pro`
 * ordering, and `resolve` echoes the supplied tier/credits with a `'none'`
 * subscription. Structurally matches `EntitlementsProvider` from
 * `@acme/entitlements` without importing it — tooling must not depend on
 * platform packages.
 */
export function createMockEntitlements(opts: {
  tier: SubscriptionTier;
  credits: CreditInfo;
}) {
  const rank: Record<SubscriptionTier, number> = {
    Basic: 0,
    Standard: 1,
    Pro: 2,
  };
  return {
    resolve: () =>
      Promise.resolve({
        subscription: { status: 'none' as const },
        tier: opts.tier,
        credits: opts.credits,
      }),
    consume: () => Promise.resolve(),
    isTierAtLeast: (tier: SubscriptionTier, minTier: SubscriptionTier) =>
      rank[tier] >= rank[minTier],
  };
}

// ============================================================================
// Telemetry Mocks
// ============================================================================

/**
 * Creates a noop telemetry object for tests.
 * This avoids the need for OpenTelemetry setup in tests while maintaining the interface.
 */
export function createNoopTelemetry() {
  const noopSpan: Partial<Span> = {
    setAttribute: function () {
      return noopSpan as Span;
    },
    setAttributes: function () {
      return noopSpan as Span;
    },
    addEvent: function () {
      return noopSpan as Span;
    },
    setStatus: function () {
      return noopSpan as Span;
    },
    recordException: function () {
      /* noop */
    },
    end: function () {
      /* noop */
    },
    spanContext: function () {
      return {
        traceId: 'test-trace-id',
        spanId: 'test-span-id',
        traceFlags: 0,
      } as SpanContext;
    },
    isRecording: function () {
      return false;
    },
  };

  const noopTracer: Partial<Tracer> = {
    startSpan: function () {
      return noopSpan as Span;
    },
  };

  return {
    path: 'test',
    traceId: 'test-trace-id',
    spanId: 'test-span-id',
    span: noopSpan as Span,
    tracer: noopTracer as Tracer,

    set: function (_attributes: Record<string, string | number | boolean>) {
      /* noop */
    },
    event: function (
      _name: string,
      _attributes?: Record<string, string | number | boolean>,
    ) {
      /* noop */
    },

    withSpan: async function <T>(
      _name: string,
      fn: (span: Span) => Promise<T> | T,
    ): Promise<T> {
      return fn(noopSpan as Span);
    },

    withChildSpan: async function <T>(
      _name: string,
      fn: (span: Span) => Promise<T> | T,
    ): Promise<T> {
      return fn(noopSpan as Span);
    },

    parseWithTelemetry: function <T>(schema: ZodType<T>, data: unknown): T {
      return schema.parse(data);
    },

    safeParseWithTelemetry: function <T>(
      schema: ZodType<T>,
      data: unknown,
    ): ReturnType<ZodType<T>['safeParse']> {
      return schema.safeParse(data);
    },
  };
}

// ============================================================================
// Stripe Mocks
// ============================================================================

/**
 * Create mock Stripe client.
 * Add methods as needed for your tests.
 */
export function createMockStripe() {
  return {
    customers: {
      create: () => Promise.resolve({ id: 'cus_test' }),
      retrieve: () =>
        Promise.resolve({ id: 'cus_test', email: 'test@example.com' }),
    },
    subscriptions: {
      create: () => Promise.resolve({ id: 'sub_test', status: 'active' }),
      retrieve: () => Promise.resolve({ id: 'sub_test', status: 'active' }),
    },
    checkout: {
      sessions: {
        create: () =>
          Promise.resolve({
            id: 'cs_test',
            url: 'https://checkout.stripe.com/test',
          }),
      },
    },
  };
}
