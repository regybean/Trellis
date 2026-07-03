/**
 * Shared Test Utilities
 *
 * @module @acme/test-utils
 *
 * The generic test-infra engine: a suite names the infra it needs as
 * `InfraDescriptor`s (owned by the infra package — `@acme/db/testing`,
 * `@acme/redis/testing`) and hands them to `runInfraSetup` from a per-suite
 * global-setup file; this package turns them into running testcontainers,
 * hydrates env, and provides the shared vitest backend preset (`./vitest`). It
 * holds the *mechanism*, not the knowledge of which package needs what (that's
 * the suite) or how each infra is built (that's the owner). See docs/adr/0017.
 * The tRPC caller context + mocks live in `@acme/trpc/testing`; Redis flush
 * helpers in `@acme/redis/testing`.
 */

// Infra descriptor contract
export type { InfraDescriptor, InfraBindMount } from './infra';

// Engine
export type { StartedInfra } from './containers';
export { startInfra, stopInfra, pushDatabaseSchemas } from './containers';

// Global setup factory
export { runInfraSetup } from './setup';
