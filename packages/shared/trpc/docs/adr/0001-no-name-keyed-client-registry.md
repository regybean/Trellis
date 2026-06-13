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
   Clerk's server SDK, Redis and Drizzle. If the browser client resolved its router
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
