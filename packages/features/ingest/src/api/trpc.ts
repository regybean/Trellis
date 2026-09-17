import { initTRPC } from '@trpc/server';

import type { BaseContext } from '@acme/trpc';
import {
  requirePrincipal,
  trpcConfig,
  withProcedureSpan,
  withTimingLog,
} from '@acme/trpc';

/**
 * Ingest's tRPC instance, built on its own concrete context: the neutral
 * `BaseContext` the app adapter injects, and nothing else. Ingest owns no
 * database and has no tier to gate on, so it names neither a Drizzle client nor
 * a billing type.
 *
 * This survived the Data Source work unchanged, which is the point. Ingest now
 * creates, renames, deletes and lists Data Sources and asserts ownership on
 * every Document call — and still holds no client, because all of it goes
 * through `@acme/rag/server`'s module-private ones. Widen this type to carry a
 * `db` and the ownership predicate becomes bypassable from inside this package.
 */
export type IngestContext = BaseContext;

const t = initTRPC.context<IngestContext>().create(trpcConfig);

// The shared middleware stack, composed against ingest's own concrete context.
// The bodies live once in `@acme/trpc` as plain async helpers; only this wiring
// is per-feature.
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
// Every procedure in this feature is `protectedProcedure`. There is no admin
// gate left: Documents and Data Sources are the signed-in user's own, and
// authorization is row ownership rather than a role — asserted per call against
// `data_source` in `@acme/rag/server`.
export const protectedProcedure = publicProcedure.use(authed);
