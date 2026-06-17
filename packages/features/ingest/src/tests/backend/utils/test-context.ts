/**
 * Test Context Factory
 *
 * Builds a context matching the structure of ingest's tRPC context and passes
 * it straight to `appRouter.createCaller`. We stub Clerk auth and supply a
 * default billing context — no Redis/DB, because ingest's procedures read none
 * of it (auth/role come from the stubbed `auth`, and no procedure uses
 * rateLimit).
 */

import type { TestContextOptions } from '@acme/test-utils';
import {
  createMockAuth,
  createMockEntitlements,
  createMockUser,
  createNoopTelemetry,
} from '@acme/test-utils';

import type { createTRPCContext } from '../../../api/trpc';

type TRPCContext = Awaited<ReturnType<typeof createTRPCContext>>;

export function createTestContext(opts: TestContextOptions): TRPCContext {
  const periodStart = Math.floor(Date.now() / 1000);
  const periodEnd = periodStart + 86_400 * 30;

  const subscription =
    opts.tier === 'Basic'
      ? {
          status: 'none' as const,
          subscriptionId: null,
          product: null,
          priceId: null,
          currentPeriodStart: null,
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
          paymentMethod: null,
        }
      : {
          status: 'active' as const,
          subscriptionId: 'test-sub-id',
          product:
            opts.tier === 'Standard' ? 'prod_standard_12345' : 'prod_pro_12345',
          priceId:
            opts.tier === 'Standard'
              ? 'price_standard_12345'
              : 'price_pro_12345',
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: false,
          paymentMethod: null,
        };

  return {
    headers: new Headers(),
    auth: createMockAuth(opts.userId, opts.role),
    user: createMockUser(opts.userId),
    entitlements: createMockEntitlements({
      tier: opts.tier,
      credits: opts.credits,
    }),
    subscription,
    tier: opts.tier,
    credits: opts.credits,
    telemetry: createNoopTelemetry(),
  };
}
