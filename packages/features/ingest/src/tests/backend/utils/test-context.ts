/**
 * Test Context — ingest.
 *
 * The tRPC caller context comes from the one canonical builder
 * (`@acme/trpc/testing`). Ingest's async pipeline uses an isolated Redis logical
 * DB for the per-user progress stream; `cleanupTestData` flushes it between tests.
 */

import { flushTestDb } from '@acme/redis/testing';

export { createTestContext } from '@acme/trpc/testing';
export type { TestContextOptions } from '@acme/trpc/testing';

/** Flush this suite's isolated Redis DB (the per-user progress streams). */
export async function cleanupTestData() {
  await flushTestDb();
}
