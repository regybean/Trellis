/**
 * Test Context — billing.
 *
 * The tRPC caller context comes from the one canonical builder
 * (`@acme/trpc/testing`); this file only owns billing's data cleanup. Billing
 * has no feature tables — its state lives entirely in the isolated Redis DB.
 */

import type { FeatureTestContextOptions } from '@acme/trpc/testing';
import { flushTestDb } from '@acme/redis/testing';
import { createTestContext as createBaseTestContext } from '@acme/trpc/testing';

/**
 * The knobs billing's backend tests vary. Identical for every feature; only the
 * principal differs, which is why building it is the feature's job.
 */
export type TestContextOptions = FeatureTestContextOptions;

/**
 * Build the tRPC caller context. The one canonical builder lives in
 * `@acme/trpc/testing`; this wrapper supplies the `InjectedUser` billing's own
 * program declares — including the `primaryEmailAddress` billing augments the
 * seam with, which the account router opens a Stripe customer against. The
 * platform package knows nothing about that field; this is the only place that
 * has to.
 */
export function createTestContext({
  userId,
  role,
  ...entitlements
}: TestContextOptions) {
  return createBaseTestContext({
    user: {
      id: userId,
      role,
      primaryEmailAddress: { emailAddress: 'test@example.com' },
    },
    ...entitlements,
  });
}

/** Flush the isolated Redis DB between tests for isolation. */
export async function cleanupTestData() {
  await flushTestDb();
}
