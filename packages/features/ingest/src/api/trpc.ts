import { initTRPC } from '@trpc/server';

import type { BaseContext } from '@acme/trpc';
import {
  requireAdmin,
  requirePrincipal,
  trpcConfig,
  withProcedureSpan,
  withTimingLog,
} from '@acme/trpc';

/**
 * Ingest's tRPC instance, built on its own concrete context: the neutral
 * `BaseContext` the app adapter injects, and nothing else. Ingest owns no
 * database and has no tier to gate on, so it names neither a Drizzle client nor
 * a billing type (#256, ADR 0006).
 */
export type IngestContext = BaseContext;

const t = initTRPC.context<IngestContext>().create(trpcConfig);

// The shared middleware stack, composed against ingest's own concrete context.
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
