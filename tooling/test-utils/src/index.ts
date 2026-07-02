/**
 * Shared Test Utilities
 *
 * @module @acme/test-utils
 *
 * Infra-only test tooling: testcontainers, global setup/teardown, env
 * hydration, and the shared vitest backend preset (`./vitest`). The tRPC caller
 * context + mocks live in `@acme/trpc/testing`; Redis flush helpers in
 * `@acme/redis/testing` — owned by the packages whose real types they need,
 * since this tooling package sits below `platform` and cannot import them.
 */

// Types
export type { TestContainers } from './containers';

// Containers
export {
  startContainers,
  startPostgresContainer,
  startRedisContainer,
  stopContainers,
} from './containers';

// Setup
export { setup, teardown } from './setup';
