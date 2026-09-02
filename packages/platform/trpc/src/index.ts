import 'server-only';

// `ProcedureType` is re-exported from the root barrel too, but importing it
// from this subpath is load-bearing beyond naming the type. tRPC declares its
// builder types in one internal module that the barrel only re-exports from;
// with a concrete context the builder `buildCore` returns collapsed to something
// the barrel could name, and generic in the extension it no longer does, so
// declaration emit fails with TS2742 unless some import names the module by a
// path. Annotating the two factories by hand is the alternative, and their types
// run to hundreds of characters of tRPC internals.
import type { ProcedureType } from '@trpc/server/unstable-core-do-not-import';
import { context, trace } from '@opentelemetry/api';
import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import { z, ZodError } from 'zod/v4';

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

/**
 * The injected principal — `ctx.session.user`. A concrete, exported interface,
 * imported like any other type.
 *
 * It used to be an augmentable global, because the one field beyond `id`/`role`
 * that anyone added was Clerk's nested primary-address object — a shape a
 * platform package could not name without depending on Clerk's SDK. Clerk is
 * gone; Better Auth stores `user.email: string`, and
 * platform can name a string perfectly well. So the mechanism outlived its
 * reason and was costing two hand-synced declarations, two app tsconfigs
 * reaching across the workspace by relative path to load them, and no compiler
 * check that any of it agreed (#250, ADR 0003 amendment).
 *
 * The substrate itself still reads only `id` (identity) and `role` (the
 * `adminProcedure` gate). `email` is here because `@acme/billing` opens a Stripe
 * customer against it, and optional because the slim apps inject a constant
 * `{ id: 'local', role: 'admin' }` and drop billing entirely (ADR 0010).
 */
export interface InjectedUser {
  id: string;
  role?: Roles;
  email?: string;
}

/**
 * The whole of the session the platform consumes: a principal, or nothing.
 * `protectedProcedure` narrows it to a non-null `InjectedUser`.
 */
export interface InjectedSession {
  user: InjectedUser | null;
}

/**
 * The neutral, feature-agnostic half of a request context: the request itself
 * plus the injected principal. Everything a *feature* needs on top arrives as
 * that feature's own **context extension** — a type parameter it hands to
 * `createFeatureTRPC` / `createFeatureTRPCWithDb`, which the substrate merges in
 * and never names.
 *
 * One name for both roles, because they are one object: what the app adapter
 * injects *is* the base half of `ctx`, since `createTRPCContext` passes it
 * through untouched. It was briefly `ContextOpts` — two names for the same
 * fields, disagreeing with `CONTEXT.md`, which has always called this the base
 * context.
 *
 * Billing used to be a field here. `entitlements: EntitlementsProvider` was
 * required on every context, so constructing one meant importing the billing
 * contract — in `@acme/feedback`, in `@acme/ingest`, in the slim apps, none of
 * which have a tier or a credit to their name. Nothing in the substrate had read
 * it since #250; the type was the last of the coupling. It is now `@acme/billing`
 * and `@acme/chat`'s extension (#256, ADR 0006 amendment).
 */
export interface BaseContext {
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
   * out). Mapping a provider's user onto `InjectedUser` is the app's job — the
   * full apps share `@acme/auth`'s `toPrincipal`, the slim apps inject a
   * constant (ADR 0003 / 0010).
   */
  session: InjectedSession;
}

type DrizzleDb = Parameters<typeof instrumentDrizzleClient>[0];

/**
 * Builds a feature's request context: the neutral base merged with the
 * feature's own extension, passed straight through. `TExtension` defaults to
 * `object` — "this feature needs nothing beyond a session", which is `feedback`
 * and `ingest` — so the common case names no type at all.
 *
 * It does no I/O, and now not even a field read: the substrate has nothing to
 * pick out of the extension. It used to `await entitlements.resolve()` here,
 * which cost every tRPC call in both full apps 2-4 Redis round-trips whether or
 * not the procedure read the result — and the one router that did read it
 * re-resolved anyway. A procedure that needs entitlements resolves them where
 * it uses them (#250, ADR 0006 amendment).
 *
 * Still returns a promise: the app adapters await it, and the shape a future
 * context needs to assemble asynchronously shouldn't churn the resolver seam.
 *
 * Telemetry is ambient — the telemetry middleware owns the per-procedure span
 * and everything reads it from the active OTel context (ADR 0023), so nothing
 * is threaded here.
 */
export function createTRPCContext<TExtension extends object = object>(
  opts: BaseContext & TExtension,
) {
  return Promise.resolve({ ...opts });
}

/**
 * Wraps a procedure invocation in its OTel span: one span per procedure, named
 * `trpc.<path>`, carrying status, duration and any thrown error.
 *
 * The span lifecycle lives out here as plain code with no tRPC types in it,
 * because the middleware that calls it has to be an *inline* arrow to compile
 * at all — see `buildCore`. Keeping the bodies out here is what lets those
 * arrows stay one-liners.
 */
async function withProcedureSpan<T>(
  meta: { path: string; type: ProcedureType; userId?: string },
  run: () => Promise<T>,
) {
  const start = Date.now();
  const span = getTracer().startSpan(`trpc.${meta.path}`, {}, context.active());

  span.setAttributes({
    'trpc.procedure.path': meta.path,
    'trpc.procedure.type': meta.type,
    ...(meta.userId && { 'user.id': meta.userId }),
  });

  try {
    const result = await context.with(
      trace.setSpan(context.active(), span),
      run,
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
}

/**
 * Logs a procedure's wall-clock duration, plus an artificial 100-500ms stall in
 * dev so local UIs actually render their loading states. Extracted for the same
 * reason as `withProcedureSpan`.
 */
async function withTimingLog<T>(
  path: string,
  isDev: boolean,
  run: () => Promise<T>,
) {
  const start = Date.now();

  if (isDev) {
    const waitMs = Math.floor(Math.random() * 400) + 100;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  const result = await run();

  logger.debug(
    { path, durationMs: Date.now() - start },
    `[TRPC] ${path} took ${Date.now() - start}ms to execute`,
  );

  return result;
}

/**
 * The `protectedProcedure` gate: a principal, or UNAUTHORIZED. It *returns* the
 * principal so the middleware can re-inject the narrowed session — that
 * re-injection is what gives every downstream procedure a non-null
 * `ctx.session.user`.
 */
function requirePrincipal(session: InjectedSession) {
  const span = trace.getActiveSpan();
  const { user } = session;

  if (!user) {
    span?.addEvent('auth.denied', { reason: 'not_authenticated' });
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'You must be logged in to access this resource.',
    });
  }

  span?.addEvent('auth.granted');

  return user;
}

/** The `adminProcedure` gate: an admin principal, or UNAUTHORIZED. */
function requireAdmin(session: InjectedSession) {
  const span = trace.getActiveSpan();
  const { user } = session;

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

  return user;
}

/**
 * Initializes a tRPC instance and the full middleware stack for one feature's
 * context. Generic in the *extension* only; the base half stays concrete, so the
 * gates below still narrow `ctx.session.user` against a real type. The extension
 * is opaque here — the substrate carries it and reads none of it.
 *
 * Every middleware is an inline arrow passed straight to `.use`, and has to be.
 * A generic context leaves tRPC's `ContextCallback` conditionals unresolved, and
 * the `MiddlewareBuilder` a standalone `t.middleware(fn)` produces then stops
 * being assignable to what `.use` wants — the two sides only agree once the
 * context is concrete. Passed inline, the arrow is contextually typed by `.use`
 * itself and the two never have to be compared. This is the constraint the old
 * concrete-context comment was really about; it costs an inline arrow, not the
 * type parameter.
 */
function buildCore<TExtension extends object>() {
  const t = initTRPC.context<BaseContext & TExtension>().create({
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

  const publicProcedure = t.procedure
    .use(({ next, path, type, ctx }) =>
      withProcedureSpan({ path, type, userId: ctx.session.user?.id }, next),
    )
    .use(({ next, path }) => withTimingLog(path, t._config.isDev, next));

  const protectedProcedure = publicProcedure.use(({ next, ctx }) =>
    next({ ctx: { session: { user: requirePrincipal(ctx.session) } } }),
  );

  const adminProcedure = publicProcedure.use(({ next, ctx }) =>
    next({ ctx: { session: { user: requireAdmin(ctx.session) } } }),
  );

  return {
    t,
    api: {
      // Pinned to this feature's extension, so its `createTRPCContext`
      // re-export asks callers for exactly the fields its procedures read.
      createTRPCContext: createTRPCContext<TExtension>,
      createTRPCRouter: t.router,
      createCallerFactory: t.createCallerFactory,
      publicProcedure,
      protectedProcedure,
      adminProcedure,
    },
  };
}

/**
 * Feature tRPC for a feature with no database. Every procedure receives the
 * neutral base context, plus whatever `TExtension` the feature declares — see
 * `@acme/chat`'s `api/trpc.ts` for a feature that declares one and
 * `@acme/ingest`'s for one that doesn't.
 */
export function createFeatureTRPC<TExtension extends object = object>() {
  return buildCore<TExtension>().api;
}

/**
 * Feature tRPC for a feature with a database. The Drizzle client is
 * instrumented for tracing and injected into every procedure's context as
 * `ctx.db`, typed to the feature's own schema (`TDb`).
 *
 * `TDb` comes first because it is inferred from `db`; a feature that also wants
 * a context extension names both (`createFeatureTRPCWithDb<db, MyContext>(_db)`),
 * since TypeScript won't mix inference with a partial type-argument list.
 */
export function createFeatureTRPCWithDb<
  TDb extends DrizzleDb,
  TExtension extends object = object,
>(db: TDb) {
  instrumentDrizzleClient(db, { dbSystem: 'postgresql' });

  const { api } = buildCore<TExtension>();

  // Inlined per procedure rather than shared as one `t.middleware`, for the
  // reason `buildCore` documents: a standalone middleware builder doesn't
  // survive a generic context.
  return {
    ...api,
    publicProcedure: api.publicProcedure.use(({ next }) =>
      next({ ctx: { db } }),
    ),
    protectedProcedure: api.protectedProcedure.use(({ next }) =>
      next({ ctx: { db } }),
    ),
    adminProcedure: api.adminProcedure.use(({ next }) => next({ ctx: { db } })),
  };
}
