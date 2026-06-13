import 'server-only';

import { auth, currentUser } from '@clerk/nextjs/server';
import { context, trace } from '@opentelemetry/api';
import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import { z, ZodError } from 'zod/v4';

import type { SubscriptionTier } from '@acme/subscriptions';
import { logger } from '@acme/logger';
import { redis } from '@acme/redis';
import {
  getCredits,
  getSubscriptionType,
  getUserSubscriptionFromRedis,
  isTierAtLeast,
} from '@acme/subscriptions';
import { instrumentDrizzleClient } from '@acme/telemetry';
import {
  createProcedureTelemetry,
  createTelemetryContext,
  getTracer,
  SpanStatusCode,
} from '@acme/telemetry/server';

interface HttpOpts {
  headers: Headers;
  req?: Request;
  res?: Response;
}

export interface RateLimitOptions {
  /** Number of credits to consume for this request */
  credits?: number;
}

type DrizzleDb = Parameters<typeof instrumentDrizzleClient>[0];

/**
 * Builds the base request context shared by every feature: Clerk auth + user,
 * the billing context (subscription / tier / credits) and a noop telemetry
 * object (replaced per-procedure by the telemetry middleware).
 */
export async function createTRPCContext(opts: HttpOpts) {
  const authResult = await auth();
  const user = await currentUser();
  const subscription = await getUserSubscriptionFromRedis(authResult.userId);
  const tier = getSubscriptionType(subscription);
  const credits = await getCredits(authResult.userId, subscription, tier);
  const telemetry = createTelemetryContext();

  return {
    ...opts,
    auth: authResult,
    user,
    subscription,
    credits,
    tier,
    telemetry,
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
        ...(ctx.auth.userId && { 'user.id': ctx.auth.userId }),
      });

      const telemetry = createProcedureTelemetry(path, span);

      try {
        const result = await context.with(
          trace.setSpan(context.active(), span),
          () => next({ ctx: { telemetry } }),
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
    if (!ctx.auth.userId) {
      ctx.telemetry.event('auth.denied', { reason: 'not_authenticated' });
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'You must be logged in to access this resource.',
      });
    }

    ctx.telemetry.event('auth.granted');

    return next({ ctx: { auth: ctx.auth } });
  });

  const isAdmin = t.middleware(({ next, ctx }) => {
    const role = ctx.auth.sessionClaims?.metadata.role;

    if (role !== 'admin') {
      ctx.telemetry.event('auth.denied', {
        reason: 'not_admin',
        actual_role: role ?? 'none',
      });
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'You must be an admin to access this resource.',
      });
    }

    ctx.telemetry.set({ 'user.role': 'admin' });
    ctx.telemetry.event('auth.granted', { role: 'admin' });

    return next({ ctx: { auth: ctx.auth } });
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
      const creditsToConsume = opts.credits ?? 1;
      const { auth: authCtx, credits, tier } = ctx;
      const userId = authCtx.userId;
      const key = `credits:${userId}:${tier}`;

      ctx.telemetry.set({
        'rateLimit.creditsToConsume': creditsToConsume,
        'rateLimit.creditsRemaining': credits.remaining,
        'rateLimit.tier': tier,
        'rateLimit.userId': userId ?? 'none',
      });

      if (!userId) {
        ctx.telemetry.event('rateLimit.denied', {
          reason: 'not_authenticated',
        });
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'You must be logged in to access this resource.',
        });
      }

      if (credits.remaining < creditsToConsume) {
        ctx.telemetry.event('rateLimit.exceeded', {
          creditsToConsume,
          creditsRemaining: credits.remaining,
        });
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: 'You do not have enough credits to complete the request',
        });
      }

      await redis.decrBy(key, creditsToConsume);

      ctx.telemetry.event('rateLimit.passed', {
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
      ctx.telemetry.set({
        'subscription.status': ctx.subscription.status,
        'subscription.tier': ctx.tier,
      });

      if (!isTierAtLeast(ctx.tier, minTier)) {
        ctx.telemetry.event('subscription.check.denied', {
          reason: 'insufficient_tier',
          required: minTier,
          actual: ctx.tier,
        });
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: `This feature requires the ${minTier} tier or higher.`,
        });
      }

      ctx.telemetry.event('subscription.check.granted', { tier: ctx.tier });

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
 * base context (auth + billing + telemetry).
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
