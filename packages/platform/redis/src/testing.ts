/**
 * Redis test helpers — shipped as the `@acme/redis/testing` export subpath.
 *
 * The single place a backend suite flushes its data. Suites get an isolated
 * logical Redis DB (via `TEST_REDIS_DB` in their vitest config), so a full
 * `flushDb()` only wipes this suite's keyspace — never a parallel suite's. Prod
 * code never imports this subpath.
 */
import { redis } from './client';

/**
 * Flush this suite's Redis logical DB for test isolation. Call from
 * `beforeEach`/`afterEach`. Connects lazily if the client isn't open yet.
 */
export async function flushTestDb() {
  if (!redis.isOpen) {
    await redis.connect();
  }
  await redis.flushDb();
}
