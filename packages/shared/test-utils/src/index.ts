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
export type {
  CreditInfo,
  SubscriptionTier,
  MockSubscription,
  TestContextOptions,
} from './mocks';
export type { TestContainers } from './containers';

// Mock functions
export {
  createMockAuth,
  createMockUser,
  createDefaultCredits,
  createNoopTelemetry,
  createMockStripe,
} from './mocks';

// Containers
export {
  startPostgresContainer,
  startRedisContainer,
  startContainers,
  stopContainers,
} from './containers';

// Setup
export { setup, teardown } from './setup';
