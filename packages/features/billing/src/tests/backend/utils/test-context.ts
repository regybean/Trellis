/**
 * Test Context — billing.
 *
 * The tRPC caller context comes from the one canonical builder
 * (`@acme/trpc/testing`); this file only owns billing's data cleanup. Billing
 * has no feature tables — its state lives entirely in the isolated Redis DB.
 */

import { flushTestDb } from '@acme/redis/testing';

export { createTestContext } from '@acme/trpc/testing';
export type { TestContextOptions } from '@acme/trpc/testing';

/** Flush the isolated Redis DB between tests for isolation. */
export async function cleanupTestData() {
  await flushTestDb();
}
