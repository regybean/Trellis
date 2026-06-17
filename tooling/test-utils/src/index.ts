/**
 * Shared Test Utilities
 *
 * @module @acme/test-utils
 *
 * This package provides:
 * - Mock helpers for Clerk, Telemetry, Stripe (./mocks)
 * - Testcontainers for PostgreSQL and Redis (./containers)
 * - Global setup/teardown for vitest (./setup)
 */

// Types
export type { TestContainers } from './containers';
export type {
  CreditInfo,
  MockSubscription,
  SubscriptionTier,
  TestContextOptions,
} from './mocks';

// Mock functions
export {
  createDefaultCredits,
  createMockAuth,
  createMockEntitlements,
  createMockStripe,
  createMockUser,
  createNoopTelemetry,
} from './mocks';

// Containers
export {
  startContainers,
  startPostgresContainer,
  startRedisContainer,
  stopContainers,
} from './containers';

// Setup
export { setup, teardown } from './setup';
