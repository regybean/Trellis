import 'server-only';

import { context, trace } from '@opentelemetry/api';
import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import { z, ZodError } from 'zod/v4';

import type {
  EntitlementsProvider,
  SubscriptionTier,
} from '@acme/entitlements';
import { logger } from '@acme/logger';
import { instrumentDrizzleClient } from '@acme/telemetry';
import { getTracer, SpanStatusCode } from '@acme/telemetry/server';

/**
 * The session seam. The *app's* adapter resolves whoever its auth provider says
 * is calling and injects the result here; this package names no provider and
 * depends on no auth SDK. See docs/adr/0003-framework-agnostic-auth-seam.md and
 * docs/adr/0006-entitlements-injection-seam.md.
 */

/** The role union `adminProcedure` gates on. Declared once, here. */
export type Roles = 'admin' | 'user';

declare global {
  /**
   * The injected principal — `ctx.session.user`. Open by design: the substrate
   * reads only `id` (identity) and `role` (the `adminProcedure` gate), so the
   * base declares exactly those, and consumers that need more *augment* it.
   *
   * The declaration lives in this module rather than a `global.d.ts` on
   * purpose: `tsc` emits it into `dist/index.d.ts`, so every program that
   * imports `@acme/trpc` inherits the base instead of restating it. Augmenting
   * is then additive — `@acme/billing` contributes the primary email its Stripe
   * customer lookup reads, `@acme/auth` contributes what the full apps map off
   * a Clerk `User` — and no package has to keep a copy of the base in sync.
   */
  interface InjectedUser {
    id: string;
    role?: Roles;
  }
}

/**
 * The whole of the session the platform consumes: a principal, or nothing.
 * `user` is the augmentable `InjectedUser` global above, whose base carries the
 * only two fields the substrate reads — `id` and `role`.
 * `protectedProcedure` narrows it to a non-null `InjectedUser`.
 */
export interface InjectedSession {
  user: InjectedUser | null;
}

/**
 * Re-exported so app adapters and RSC callers can type the injected billing
 * policy without taking a direct dependency on `@acme/entitlements`.
 */
export type { EntitlementsProvider } from '@acme/entitlements';

interface ContextOpts {
  headers: Headers;
  req?: Request;
  res?: Response;
  /**
   * The app's own public origin (scheme + host + port), injected by the app
   * adapter — its `PORT` in dev, its deploy origin in prod. Optional: a build
   * that never constructs an absolute redirect URL (e.g. the slim apps, which
   * strip billing) need not thread it. Billing combines it with the config-owned
   * checkout paths to build the Stripe redirect URLs (ADR 0033).
   */
  origin?: string;
  /**
   * The resolved session, injected by the app adapter (`user: null` when signed
   * out). `user` is typed via the augmentable `InjectedUser` global, so an app
   * can sharpen it to its own principal shape (the full apps add the fields
   * they map off their provider's user).
   */
  session: InjectedSession;
  /**
   * The billing policy — rate limiting + tier gating. Required, with no
   * implicit default (mirroring the auth seam): a deployment must explicitly
   * inject either the `@acme/subscriptions` adapter or, for a no-billing build,
   * `unlimitedEntitlements` from `@acme/entitlements`.
   */
  entitlements: EntitlementsProvider;
}

export interface RateLimitOptions {
  /** Number of credits to consume for this request */
  credits?: number;
}

type DrizzleDb = Parameters<typeof instrumentDrizzleClient>[0];

/**
 * Builds the base request context shared by every feature from the
 * app-injected session + entitlements provider: resolves the billing
 * context (subscription / tier / credits) through the provider. Telemetry is
 * ambient — the telemetry middleware owns the per-procedure span and everything
 * reads it from the active OTel context (ADR 0023), so nothing is threaded here.
 */
export async function createTRPCContext(opts: ContextOpts) {
  const { session, entitlements, ...rest } = opts;
  const { subscription, tier, credits } = await entitlements.resolve(
    session.user?.id ?? null,
  );

  return {
    ...rest,
    session,
    entitlements,
    subscription,
    credits,
    tier,
  };
}

type BaseContext = Awaited<ReturnType<typeof createTRPCContext>>;

/**
 * Initializes a concrete (non-generic) tRPC instance and the full middleware
 * stack. Keeping the context type concrete here is deliberate: a generic
 * context parameter makes tRPC's middleware conditional types explode.
 */
function buildCore() {
  const t = initTRPC.context<BaseContext>().create({
    transformer: superjson,
    errorFormatter({ shape, error }) {
      return {
        ...shape,
        data: {
          ...shape.data,
          zodError:
            error.cause instanceof ZodError
              ? z.treeifyError(error.cause)
              : null,
        },
      };
    },
  });

  const telemetryMiddleware = t.middleware(
    async ({ next, path, type, ctx }) => {
      const tracer = getTracer();
      const start = Date.now();
      const span = tracer.startSpan(`trpc.${path}`, {}, context.active());

      span.setAttributes({
        'trpc.procedure.path': path,
        'trpc.procedure.type': type,
        ...(ctx.session.user && { 'user.id': ctx.session.user.id }),
      });

      try {
        const result = await context.with(
          trace.setSpan(context.active(), span),
          () => next(),
        );

        span.setAttributes({
          'trpc.procedure.status': 'success',
          'trpc.duration_ms': Date.now() - start,
        });

        return result;
      } catch (error) {
        span.setAttributes({
          'trpc.procedure.status': 'error',
          'trpc.duration_ms': Date.now() - start,
        });
        span.setStatus({ code: SpanStatusCode.ERROR });

        if (error instanceof TRPCError) {
          span.setAttributes({
            'error.code': error.code,
            'error.message': error.message,
          });
        }

        if (error instanceof Error) {
          span.recordException(error);
        }

        throw error;
      } finally {
        span.end();
      }
    },
  );

  const timingMiddleware = t.middleware(async ({ next, path }) => {
    const start = Date.now();

    if (t._config.isDev) {
      const waitMs = Math.floor(Math.random() * 400) + 100;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    const result = await next();

    logger.debug(
      { path, durationMs: Date.now() - start },
      `[TRPC] ${path} took ${Date.now() - start}ms to execute`,
    );

    return result;
  });

  const isAuthed = t.middleware(({ next, ctx }) => {
    const span = trace.getActiveSpan();
    const { user } = ctx.session;
    if (!user) {
      span?.addEvent('auth.denied', { reason: 'not_authenticated' });
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'You must be logged in to access this resource.',
      });
    }

    span?.addEvent('auth.granted');

    // Re-injecting the narrowed session is what gives every downstream
    // procedure a non-null `ctx.session.user`.
    return next({ ctx: { session: { user } } });
  });

  const isAdmin = t.middleware(({ next, ctx }) => {
    const span = trace.getActiveSpan();
    const { user } = ctx.session;

    // Checked through the optional chain rather than via an aliased `role`, so
    // the admitted path narrows `user` to a non-null principal.
    if (user?.role !== 'admin') {
      span?.addEvent('auth.denied', {
        reason: 'not_admin',
        actual_role: user?.role ?? 'none',
      });
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'You must be an admin to access this resource.',
      });
    }

    span?.setAttributes({ 'user.role': 'admin' });
    span?.addEvent('auth.granted', { role: 'admin' });

    // An admin role implies a principal, so this narrows `user` too.
    return next({ ctx: { session: { user } } });
  });

  const publicProcedure = t.procedure
    .use(telemetryMiddleware)
    .use(timingMiddleware);

  const protectedProcedure = publicProcedure.use(isAuthed);
  const adminProcedure = publicProcedure.use(isAdmin);

  /**
   * Token-bucket rate limiter. Reads `credits`/`tier` from the billing context
   * and decrements the per-user, per-tier credit count in Redis.
   */
  const rateLimit = (opts: RateLimitOptions = {}) =>
    t.middleware(async ({ next, ctx }) => {
      const span = trace.getActiveSpan();
      const creditsToConsume = opts.credits ?? 1;
      const { session, credits, tier } = ctx;
      const userId = session.user?.id ?? null;

      span?.setAttributes({
        'rateLimit.creditsToConsume': creditsToConsume,
        'rateLimit.creditsRemaining': credits.remaining,
        'rateLimit.tier': tier,
        'rateLimit.userId': userId ?? 'none',
      });

      if (!userId) {
        span?.addEvent('rateLimit.denied', {
          reason: 'not_authenticated',
        });
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'You must be logged in to access this resource.',
        });
      }

      if (credits.remaining < creditsToConsume) {
        span?.addEvent('rateLimit.exceeded', {
          creditsToConsume,
          creditsRemaining: credits.remaining,
        });
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: 'You do not have enough credits to complete the request',
        });
      }

      await ctx.entitlements.consume(userId, tier, creditsToConsume);

      span?.addEvent('rateLimit.passed', {
        creditsConsumed: creditsToConsume,
        creditsAfter: credits.remaining - creditsToConsume,
      });

      return next();
    });

  /**
   * Hierarchical tier gate. Admits the request only if `ctx.tier` is at least
   * `minTier` in the tier ordering (`Basic < Standard < Pro`), so higher tiers
   * inherit lower-tier access. Reads the already-assembled billing context —
   * no Redis or Stripe I/O.
   */
  const requireTier = (minTier: SubscriptionTier) =>
    t.middleware(({ next, ctx }) => {
      const span = trace.getActiveSpan();
      span?.setAttributes({
        'subscription.status': ctx.subscription.status,
        'subscription.tier': ctx.tier,
      });

      if (!ctx.entitlements.isTierAtLeast(ctx.tier, minTier)) {
        span?.addEvent('subscription.check.denied', {
          reason: 'insufficient_tier',
          required: minTier,
          actual: ctx.tier,
        });
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: `This feature requires the ${minTier} tier or higher.`,
        });
      }

      span?.addEvent('subscription.check.granted', { tier: ctx.tier });

      return next();
    });

  return {
    t,
    api: {
      createTRPCContext,
      createTRPCRouter: t.router,
      createCallerFactory: t.createCallerFactory,
      publicProcedure,
      protectedProcedure,
      adminProcedure,
      rateLimit,
      requireTier,
    },
  };
}

/**
 * Feature tRPC for a feature with no database. Every procedure receives the
 * base context (auth + billing).
 */
export function createFeatureTRPC() {
  return buildCore().api;
}

/**
 * Feature tRPC for a feature with a database. The Drizzle client is
 * instrumented for tracing and injected into every procedure's context as
 * `ctx.db`, typed to the feature's own schema (`TDb`).
 */
export function createFeatureTRPCWithDb<TDb extends DrizzleDb>(db: TDb) {
  instrumentDrizzleClient(db, { dbSystem: 'postgresql' });

  const { t, api } = buildCore();
  const withDb = t.middleware(({ next }) => next({ ctx: { db } }));

  return {
    ...api,
    publicProcedure: api.publicProcedure.use(withDb),
    protectedProcedure: api.protectedProcedure.use(withDb),
    adminProcedure: api.adminProcedure.use(withDb),
  };
}
