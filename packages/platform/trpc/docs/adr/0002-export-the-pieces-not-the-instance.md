# Export the pieces; the feature builds the tRPC instance

**Status:** accepted

This package used to own the `initTRPC` call, behind `createFeatureTRPC` /
`createFeatureTRPCWithDb` — factories generic in the feature's half of the
context. It no longer builds a tRPC instance at all. It exports `trpcConfig` plus
four middleware bodies, and each feature calls
`initTRPC.context<FeatureContext>().create(trpcConfig)` itself in its own
`api/trpc.ts`.

## Why the generic factory had to go

A generic context leaves tRPC's `ContextCallback` conditionals unresolved, and
three consequences followed from that one fact:

1. **Every middleware had to be an inline arrow.** A standalone
   `t.middleware(fn)` stops being assignable to what `.use` wants once the
   context is a type parameter, so the middleware could not be factored out into
   named values.
2. **Declaration emit needed a private tRPC subpath.** Dodging TS2742 required a
   type import naming `@trpc/server/unstable-core-do-not-import` — a subpath
   tRPC marks private, in the file #219 measures as this bank's most-diverged.
3. **A feature's context was declared in one place and consumed in another**, so
   reading what a procedure actually receives meant reading two packages.

## Decision

Export the parts that cannot typecheck their way out of drift and nothing else:

- `trpcConfig` — the runtime config (transformer, error formatter).
- `withProcedureSpan`, `withTimingLog`, `requirePrincipal`, `requireAdmin` —
  plain functions with no tRPC types in them. Each feature wraps them in
  `t.middleware` and stacks them, four one-line calls.

Each middleware body takes only what it logs or decides on. `withTimingLog`
reads `NODE_ENV` itself rather than taking an `isDev` flag, so "how do we detect
dev" is not a fact five features and the generator template each restate by
reaching into tRPC's private `t._config`.

A feature then writes about twenty lines against a context with no type
parameter in it: `t.middleware()` composes normally, the private subpath is
gone, and a feature's context is declared and consumed in one file.

## The counter-argument, recorded because it is real

A factory cannot drift and hand-written wiring can. The apps _did_ drift before
`handler.ts` existed — one hand-rolled `console.error` and missed structured
logging; another omitted `OPTIONS` entirely — and middleware ordering could go
the same way.

The judgement is that twenty lines that typecheck, generator-templated, are a
smaller risk surface than a private tRPC subpath and an inline-arrow rule
nothing enforces. Everything that _can't_ typecheck its way out of drift — the
fetch handler, error logging, CORS — still lives here
([ADR 0003](0003-handler-plumbing-here-resolver-in-the-app.md)).
