import 'server-only';

import type { TRPCDefaultErrorShape, TRPCProcedureType } from '@trpc/server';
import { context, trace } from '@opentelemetry/api';
import { TRPCError } from '@trpc/server';
import superjson from 'superjson';
import { z, ZodError } from 'zod/v4';

import { logger } from '@acme/logger';
import { getTracer, SpanStatusCode } from '@acme/telemetry/server';

import { env } from './env';

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
 * plus the injected principal. A feature names its own context by extending
 * this with whatever else its procedures read, and hands *that* to
 * `initTRPC.context<…>()` — see any feature's `api/trpc.ts`.
 *
 * One name for both roles, because they are one object: what the app adapter's
 * resolver returns *is* `ctx`, handed to the fetch handler untouched (#264).
 *
 * Billing used to be a field here. `entitlements: EntitlementsProvider` was
 * required on every context, so constructing one meant importing the billing
 * contract — in `@acme/feedback`, in `@acme/ingest`, in the slim apps, none of
 * which have a tier or a credit to their name. Nothing in the substrate had read
 * it since #250; the type was the last of the coupling. It is now a field on
 * `@acme/billing` and `@acme/chat`'s own contexts (#256, ADR 0006 amendment).
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
   * checkout paths to build the Stripe redirect URLs (@acme/env ADR 0001).
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

/**
 * The runtime config every feature's tRPC instance is created with: superjson on
 * the wire, and a `zodError` tree on the error shape so a client can map a
 * validation failure back onto its form fields.
 *
 * A feature passes it straight to `initTRPC.context<MyContext>().create()`. That
 * is the whole of what this package has to say about *initialisation*; the
 * middleware stack is the four helpers below, which a feature composes against
 * its own concrete context (#264).
 *
 * `errorFormatter`'s parameter is annotated rather than contextually typed,
 * because it is written here and called there — it reads two of the six fields
 * tRPC passes, so naming those two is enough. The *return* type stays inferred:
 * `.create()` reads the wire error shape off it, and spelling it out is the one
 * way `zodError` could quietly stop reaching clients.
 */
export const trpcConfig = {
  transformer: superjson,
  errorFormatter({
    shape,
    error,
  }: {
    shape: TRPCDefaultErrorShape;
    error: TRPCError;
  }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError ? z.treeifyError(error.cause) : null,
      },
    };
  },
};

/**
 * Wraps a procedure invocation in its OTel span: one span per procedure, named
 * `trpc.<path>`, carrying status, duration and any thrown error.
 *
 * A plain async helper with no tRPC builder types in it, so the one
 * implementation serves every feature's context. The feature wraps it in a
 * one-line `t.middleware`.
 */
export async function withProcedureSpan<T>(
  meta: { path: string; type: TRPCProcedureType; userId?: string },
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
 * dev so local UIs actually render their loading states. A plain helper for the
 * same reason as `withProcedureSpan`.
 *
 * The dev check is read from this slice's own validated env rather than
 * threaded in as a parameter. Every feature passed `t._config.isDev`, which
 * made "how do we detect dev" a fact six files knew (five wirings plus the
 * generator template) and reached into tRPC's private `_config` to learn — so
 * retuning it meant editing all six (#265 review).
 *
 * `=== 'development'` is also the honest test: tRPC's `isDev` defaults to
 * `NODE_ENV !== 'production'`, so the stall used to fire under `test` too — a
 * random 100-500ms added to every procedure call in the backend suites.
 */
export async function withTimingLog<T>(path: string, run: () => Promise<T>) {
  const start = Date.now();

  if (env.NODE_ENV === 'development') {
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
export function requirePrincipal(session: InjectedSession) {
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
export function requireAdmin(session: InjectedSession) {
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
