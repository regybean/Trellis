import { initTRPC } from '@trpc/server';

import type { BaseContext } from '@acme/trpc';
import {
  requirePrincipal,
  trpcConfig,
  withProcedureSpan,
  withTimingLog,
} from '@acme/trpc';

/**
 * Notifications' tRPC instance, built on its own concrete context: the neutral
 * `BaseContext` the app adapter injects, from which the `stream` subscription
 * reads `ctx.session.user.id`. It owns no database — it is a pure Redis-stream
 * primitive — and has no tier to gate on, so it names no billing type (#256,
 * ADR 0006). This is the first `shared` package to own a tRPC router (ADR
 * 0030): the platform stays router-free and React-free.
 */
export type NotificationsContext = BaseContext;

const t = initTRPC.context<NotificationsContext>().create(trpcConfig);

// The shared middleware stack, composed against this package's own concrete
// context. The bodies live once in `@acme/trpc` as plain async helpers; only
// this wiring is per-package (#264). No admin gate — every notifications
// procedure is the caller's own stream.
const telemetry = t.middleware(({ next, path, type, ctx }) =>
  withProcedureSpan({ path, type, userId: ctx.session.user?.id }, next),
);
const timing = t.middleware(({ next, path }) => withTimingLog(path, next));
const authed = t.middleware(({ next, ctx }) =>
  next({ ctx: { session: { user: requirePrincipal(ctx.session) } } }),
);

export const createTRPCRouter = t.router;
export const createCallerFactory = t.createCallerFactory;
const publicProcedure = t.procedure.use(telemetry).use(timing);
export const protectedProcedure = publicProcedure.use(authed);
