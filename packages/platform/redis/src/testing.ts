/**
 * Redis test helpers — shipped as the `@acme/redis/testing` export subpath.
 *
 * The single place a backend suite flushes its data, plus the pure-data
 * `redisContainer` descriptor a suite opts into via
 * `backendProject({ infra: [redisContainer] })`. The descriptor is owned here,
 * beside the client it serves; `@acme/test-utils` is the engine that starts it
 * (this package carries no `testcontainers` dependency). See docs/adr/0017.
 *
 * Suites get an isolated logical Redis DB (via `TEST_REDIS_DB` in their vitest
 * config), so a full `flushDb()` only wipes this suite's keyspace — never a
 * parallel suite's. Prod code never imports this subpath.
 */
import type { InfraDescriptor } from '@acme/test-utils/infra';

export const redisContainer: InfraDescriptor = {
  name: 'redis',
  // Pinned to match the docker-compose `redis` service.
  image: 'redis:alpine',
  containerPort: 6379,
  localPort: 6379,
  waitLogRegex: 'Ready to accept connections',
  provides: {
    REDIS_URL: 'redis://{host}:{port}',
  },
};

/**
 * Flush this suite's Redis logical DB for test isolation. Call from
 * `beforeEach`/`afterEach`. Connects lazily if the client isn't open yet.
 *
 * The Redis client is imported dynamically so that loading this module for its
 * `redisContainer` descriptor — which a suite's `vitest.config` imports at
 * config-eval time — does not pull the connecting client into the config graph.
 */
export async function flushTestDb() {
  const { redis } = await import('./client');
  if (!redis.isOpen) {
    await redis.connect();
  }
  await redis.flushDb();
}
