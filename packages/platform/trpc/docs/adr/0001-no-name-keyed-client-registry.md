# Feature tRPC client wiring: two factories, no name-keyed registry

The per-feature client wiring (`trpc/react.tsx`, `server.tsx`, `query-client.ts`)
is near-identical across features, so we are consolidating it into `@acme/trpc`.
The tempting shape is a single `createFeatureTRPCClient(name)` backed by a registry
that maps a feature name to its `appRouter` + server `createTRPCContext`. We rejected
the registry and split the wiring into **two factories across two entry points**:

- `@acme/trpc/client` — `createFeatureClientReact<AppRouter>(name)` (`'use client'`)
- `@acme/trpc/server` — `createFeatureServerCaller<AppRouter>({ name, appRouter, createTRPCContext })` (`'server-only'`)

## Status

accepted

## Why a single name-keyed registry does not work cleanly

1. **A runtime registry holding `appRouter` poisons the browser bundle.** The client
   transport needs _only the `AppRouter` type_ (erased at compile time) plus a URL —
   it never needs the router value. The server caller is what needs the real
   `appRouter` + `createTRPCContext`, and those transitively pull in `server-only`,
   the auth server SDK, Redis and Drizzle. If the browser client resolved its router
   by name from a shared runtime registry, that registry would drag the server router
   into the client bundle and `server-only` would throw at build. The existing
   relative-import duplication exists _precisely_ to keep the two sides apart.

2. **A string key carries no type.** `useTRPC` / `trpc` must be typed to the specific
   feature's router for autocomplete (`trpc.jobs.list`). Types do not survive a runtime
   string lookup, so the call site must supply `<AppRouter>` regardless. The registry
   therefore cannot remove the type parameter — it could only remove the runtime values,
   which is the one thing that is unsafe to remove.

3. **Registration adds an import-order hazard for no caller-side win.** A registry
   populated by import side-effects only has an entry if the feature's registration
   module ran first. In a code-split / RSC app that ordering is fragile. Meanwhile
   `server.tsx` already has `appRouter` and `createTRPCContext` in lexical scope —
   passing them to a factory is one line; looking them up by name is one line plus a
   sequencing bug waiting to happen.

## Consequences

- The client factory keeps the desired "one string" ergonomics
  (`createFeatureClientReact<AppRouter>('chat')`) because the client side never needed
  the runtime router — only its type and a URL derived from the name.
- The server factory takes an explicit object; the values are passed, not discovered.
- `@acme/trpc` gains a client entry point and client dependencies (`@trpc/client`,
  `@tanstack/react-query`, `@trpc/tanstack-react-query`, `react`, `superjson`); the
  existing server initialization stays under the server entry.
- New features reduce to thin re-export files; the turbo generator template is updated
  to emit them.

## Amendment (#264) — the server factory is gone; the decision it argues for is not

The names above are stale. `@acme/trpc/server` no longer exists, and neither does
`createFeatureServerCaller({ name, appRouter, createTRPCContext })` — nor
`createTRPCContext` itself. Each feature now builds its own tRPC instance on its
own concrete context in `api/trpc.ts`, and writes its own `trpc/server.tsx` RSC
caller against it; `@acme/trpc` exports `trpcConfig` plus four middleware bodies
and owns no `initTRPC` call (see the package `CONTEXT.md` and ADR 0006's #264
amendment for why the generic had to go).

The rejection recorded here still holds, and is why nothing was consolidated
behind a name key when the wiring moved back into the features:

- **Reason 1 (a runtime registry poisons the browser bundle) is unchanged.** The
  client half still needs only the `AppRouter` type and a URL — `@acme/hooks`'
  `createFeatureClientReact<AppRouter>(name)` is still the one string. The server
  half still holds the real `appRouter` and pulls `server-only`, Redis and
  Drizzle behind it.
- **Reason 2 (a string key carries no type) is unchanged.** Feature routers are
  still reached through `<AppRouter>` at the call site.
- **Reason 3 (registration is an import-order hazard) now argues for less.** The
  values a mount needs — `appRouter` and the app's own context resolver — are
  already in lexical scope at the route file, so `createTRPCFetchHandler` takes
  them as arguments. It infers the context from the router it is handed and
  types `resolver` against it, which is the check the old threaded
  `createTRPCContext` was there to spell out.
