/**
 * Test Context — billing.
 *
 * The tRPC caller context comes from the one canonical builder
 * (`@acme/trpc/testing`); this file only owns billing's data cleanup. Billing
 * has no feature tables — its state lives entirely in the isolated Redis DB.
 */

import type { TestEntitlementsOptions } from '@acme/entitlements/testing';
import type { InjectedUser } from '@acme/trpc';
import type { FeatureTestContextOptions } from '@acme/trpc/testing';
import { createMockEntitlements } from '@acme/entitlements/testing';
import { flushTestDb } from '@acme/redis/testing';
import {
  createTestContext as createBaseTestContext,
  createMockSession,
} from '@acme/trpc/testing';

/**
 * The knobs billing's backend tests vary: the principal, plus the tier and
 * credits its mock provider resolves to. The tier knobs are billing's to expose
 * because `BillingContext` is billing's — a feature with no tier gate names
 * neither (#256).
 */
export interface TestContextOptions
  extends FeatureTestContextOptions, TestEntitlementsOptions {}

/**
 * Build the tRPC caller context. The one canonical builder lives in
 * `@acme/trpc/testing`; this wrapper turns billing's `userId`/`role` knobs into
 * the `InjectedUser` principal it wants — including the `email` the account
 * router opens a Stripe customer against, which billing's tests are the only
 * ones that need populated — and supplies `BillingContext`'s entitlements
 * provider, the way an app edge supplies the real one.
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
  return createBaseTestContext({
    session: createMockSession(user),
    entitlements: createMockEntitlements(entitlements),
  });
}

/** Flush the isolated Redis DB between tests for isolation. */
export async function cleanupTestData() {
  await flushTestDb();
}
