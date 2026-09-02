/**
 * Test Context — billing.
 *
 * The tRPC caller context comes from the one canonical builder
 * (`@acme/trpc/testing`); this file only owns billing's data cleanup. Billing
 * has no feature tables — its state lives entirely in the isolated Redis DB.
 */

import type { InjectedUser } from '@acme/trpc';
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
 * `@acme/trpc/testing`; this wrapper turns billing's `userId`/`role` knobs into
 * the `InjectedUser` principal it wants — including the `email` the account
 * router opens a Stripe customer against, which billing's tests are the only
 * ones that need populated.
 */
export function createTestContext({
  userId,
  role,
  ...entitlements
}: TestContextOptions) {
  const user: InjectedUser = {
    id: userId,
    role,
    email: 'test@example.com',
  };
  return createBaseTestContext({ user, ...entitlements });
}

/** Flush the isolated Redis DB between tests for isolation. */
export async function cleanupTestData() {
  await flushTestDb();
}
