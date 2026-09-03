import { trace } from '@opentelemetry/api';
import { initTRPC, TRPCError } from '@trpc/server';

import type {
  EntitlementsProvider,
  SubscriptionTier,
} from '@acme/entitlements';
import type { BaseContext } from '@acme/trpc';
import { createDb } from '@acme/db';
import { isTierAtLeast } from '@acme/entitlements';
import { instrumentDrizzleClient } from '@acme/telemetry';
import {
  requireAdmin,
  requirePrincipal,
  trpcConfig,
  withProcedureSpan,
  withTimingLog,
} from '@acme/trpc';

/**
 * Billing's Drizzle client, instrumented for tracing once at module load.
 * Billing keeps its state in Redis and queries no table of its own today, but
 * the client is still the feature's to own and instrument (#264).
 */
export const db = createDb();

instrumentDrizzleClient(db, { dbSystem: 'postgresql' });

/**
 * Billing's request context — the neutral base the app adapter injects, plus
 * the `EntitlementsProvider`.
 *
 * It is declared here, by the one feature whose whole job is billing, rather
 * than in `@acme/trpc` where it used to be a required field on every context.
 * The substrate hasn't read it since #250, so all that field bought was making
 * `@acme/feedback`, `@acme/ingest` and both slim apps import the billing
 * contract to construct a context (#256, ADR 0006 amendment). An app still
 * chooses the provider at its edge; this type is just how billing says it needs
 * one.
 */
export interface BillingContext extends BaseContext {
  entitlements: EntitlementsProvider;
}

const t = initTRPC.context<BillingContext>().create(trpcConfig);

// The shared middleware stack, composed against billing's own concrete context.
// The bodies live once in `@acme/trpc` as plain async helpers; only this wiring
// is per-feature (#264).
const telemetry = t.middleware(({ next, path, type, ctx }) =>
  withProcedureSpan({ path, type, userId: ctx.session.user?.id }, next),
);
const timing = t.middleware(({ next, path }) =>
  withTimingLog(path, t._config.isDev, next),
);
const authed = t.middleware(({ next, ctx }) =>
  next({ ctx: { session: { user: requirePrincipal(ctx.session) } } }),
);
const admin = t.middleware(({ next, ctx }) =>
  next({ ctx: { session: { user: requireAdmin(ctx.session) } } }),
);

export const createTRPCRouter = t.router;
export const createCallerFactory = t.createCallerFactory;
export const publicProcedure = t.procedure.use(telemetry).use(timing);
export const protectedProcedure = publicProcedure.use(authed);
export const adminProcedure = publicProcedure.use(admin);

/**
 * Hierarchical tier gate: admits the caller only if their tier is at least
 * `minTier` in the ordering (`Basic < Standard < Pro`), so higher tiers inherit
 * lower-tier access.
 *
 * It lives here, not in `@acme/trpc`, because tiers do (#250). The substrate is
 * shared by `feedback` and `ingest`, neither of which has a tier to gate on; the
 * only procedures that ever gated were billing's own. Built on billing's
 * `protectedProcedure` — a gate with no principal to resolve has nothing to
 * compare.
 *
 * It resolves entitlements itself rather than reading a pre-assembled billing
 * context, and injects the result, so the procedures it admits read the same
 * resolution the gate decided on instead of paying for a second one.
 */
export const requireTier = (minTier: SubscriptionTier) =>
  protectedProcedure.use(async ({ ctx, next }) => {
    const span = trace.getActiveSpan();
    const { subscription, tier } = await ctx.entitlements.resolve(
      ctx.session.user.id,
    );

    span?.setAttributes({
      'subscription.status': subscription.status,
      'subscription.tier': tier,
    });

    if (!isTierAtLeast(tier, minTier)) {
      span?.addEvent('subscription.check.denied', {
        reason: 'insufficient_tier',
        required: minTier,
        actual: tier,
      });
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `This feature requires the ${minTier} tier or higher.`,
      });
    }

    span?.addEvent('subscription.check.granted', { tier });

    return next({ ctx: { subscription, tier } });
  });
