# Hooks (`@acme/hooks`)

Small, runtime-agnostic React/TanStack-Query helpers shared across features.
No domain knowledge, no framework specifics, and **no auth provider** — a feature
or app composes these; they never reach back up.

It does ship the _client_ half of the auth seam (`AuthStatusProvider` /
`useAuthStatus`): a plain React context carrying three fields, which knows
nothing about Better Auth or sessions — the app resolves those and feeds the
result in.

## Language

**`AuthStatus` / `AuthStatusProvider` / `useAuthStatus`**:
The viewer's auth state as a feature is allowed to see it — an opaque `userId`
and the two booleans `isSignedIn` / `isLoaded` — and the context that carries it.
A **union of the three reachable states**, not three independent fields, so
`{ userId: null, isSignedIn: true }` is not representable and `userId` narrows to
a `string` on the signed-in branch. Build one with `loadingAuthStatus` /
`resolvedAuthStatus(userId)`. `isLoaded` is separate from `isSignedIn` because
"not resolved yet" and "signed out" drive different UI: a query gated on
`isSignedIn` alone fires and 401s on the first client render.

The _app_ owns resolution and mounts the provider — both full apps map
Better Auth's `useSession`, seeded from the id their server render already
resolved. `useAuthStatus` **throws** without a provider rather than defaulting to
signed-out: the silent version of that bug is a feature whose queries never
enable, which looks exactly like a logged-out user.
_Avoid_: "the session" (features never see one — a session is a database row on
the server)

**`useOptionalAuthStatus`**:
The same read, returning `null` instead of throwing when no provider is mounted.
For features the **no-auth apps also mount**: the slim apps have no provider by
design and inject a synthetic session server-side, so for them
"no provider" means _always authorized_, not _signed out_. `@acme/notifications`
is the case that forced it — its tail is mounted in all four apps and gates the
subscription on this. Keep the two apart: `null` is "this app does not do auth",
whereas signed-out is `{ isLoaded: true, isSignedIn: false }`. Prefer
`useAuthStatus` wherever the provider is guaranteed, since its throw is what
catches an app that forgot to mount one.

**`createAppQueryClient` / `AppQueryClientProvider`**:
The app's single `QueryClient` and, for the Next.js apps, the provider that
mounts it at the root of `layout.tsx`. Every feature's queries live in it, namespaced by tRPC's `keyPrefix`, so
`useQuery` has exactly one client to resolve to. It carries only what is true for
every feature — the SuperJSON `dehydrate`/`hydrate` transformer and a
`shouldDehydrateQuery` widened to pending queries for streamed SSR — and
deliberately **no `staleTime`**: a non-zero app default would silently break every
persisted query. The TanStack apps don't use the provider; their router already
owns a client for `setupRouterSsrQueryIntegration` and calls the factory in
`router.tsx`. _Avoid_: putting feature policy here (that is per query, below).

**`createFeatureClient`**:
The client half of a feature's tRPC wiring, authored once — the mirror of
the server-side instance a feature builds from `@acme/trpc`'s pieces. Returns
a feature's `'use client'`
`FeatureTRPCProvider` — a tRPC provider, **not** a `QueryClientProvider`, which
is the whole point of the name — plus `useTRPC` / `useTRPCClient`,
`usePersistedQueryOptions`, and `clearPersistedCache`. It owns everything
identical across features — the `NODE_ENV==='test'` `httpLink` switch the MSW seam
relies on, the provider tree, and the persister wiring — and parameterises only what varies:
`keyPrefix` (drives the endpoint, the query-key prefix, and the `rq-<keyPrefix>`
persister store), `nodeEnv`, the `transport` (`http` / `batch-stream` /
`blob-batch-stream` for file uploads), whether it has `subscriptions`, and an
optional `persister` (`appVersion` + `maxAge`). It lives here, not in
`@acme/trpc`, because it ships React and a `'use client'` connector, which a
platform package must not carry. All five slices — chat, feedback, ingest, notifications, billing — mount through it.
It renders **no `QueryClientProvider`**: the provider reads the app's client from
context and throws without one, so a feature is not mountable on its own.
_Avoid_: re-authoring the test-seam/provider scaffold per feature (the divergence
this retired); giving a feature its own `QueryClient`.

**`usePersistedQueryOptions`**:
The cache policy for one query a feature persists, as a fragment to spread into
that query's options: `meta: persistMeta`, the feature's `persister`, `gcTime`
pinned to its `maxAge`, and `staleTime: 0`. Shipping all four together is the
point — `staleTime: 0` is what keeps a restore stale-while-revalidate instead of
serve-stale, and as a client-level default it could drift away from the persister
it belongs to. With no persister (no `scopeKey`, no IndexedDB, or a
feature that never opted in) it degrades to two no-ops and the query is
network-only. _Avoid_: setting `persister` / `gcTime` / `staleTime` on a persisted
query by hand.

**Query persister**:
A per-query cache-to-browser mechanism built on TanStack Query's
`experimental_createQueryPersister`, backed by IndexedDB (`idb-keyval`). Restores
a query's last successful data on cold open (instant / offline read), then
background-refetches when online. `createQueryPersister({ keyPrefix, scopeKey,
appVersion, maxAge })` returns the persister; `createFeatureClient` builds it from
the feature's `persister` config and hands it out per query through
`usePersistedQueryOptions`. _Avoid_: "cache" alone
(ambiguous with the in-memory QueryClient cache — this is the persisted copy).

**`persistMeta`**:
The opt-in marker, carried by `usePersistedQueryOptions`. A query persists
**only** if its `meta` includes it. Off by default — unmarked and non-success
queries never touch storage. _Avoid_: "enable persistence globally" (there is no
global switch; it is per query).

**`keyPrefix`**:
A feature's identifier (e.g. `'chat'`, `'feedback'`), naming its own IndexedDB
store `rq-<keyPrefix>` so co-mounted features never collide.

**`scopeKey`**:
The app-supplied per-user scope (signed-in user id in full apps; `'anon'` in
slim apps). Composed with `appVersion` into the persister `buster` so a different
user or a new deploy never rehydrates a prior snapshot. Features stay
auth-agnostic — the app supplies this, not the feature.

**`clearPersistedCache(keyPrefix)`**:
Empties a feature's persisted store. App-driven: full apps call it on logout
(with `queryClient.clear()`); slim apps never do. `useClearCacheOnLogout` runs
**once** per app and clears every mounted feature's store, because the one
`queryClient.clear()` it pairs with empties the whole cache anyway.

## Relationships

- **The app resolves auth; this package only carries the answer.** Both full apps
  mount `AuthStatusProvider` from their own server-resolved session; the slim apps
  mount none at all, and a consumer reading the context optionally must treat that
  absence as authorized rather than signed-out.
- **`@acme/billing` is the auth-status consumer**, and reads the viewer through
  `useAuthStatus` rather than importing any provider — which is what keeps the
  slim apps' graph free of one.
- **It ships no `QueryClient`.** The app owns the single client; these helpers
  attach persistence to queries on the client they are given.
- **`@acme/chat`, `@acme/feedback` and `@acme/ingest` opt in per query** to the
  persister, each with its own store prefix and scope key. This package owns the
  mechanism; which queries persist is the feature's call and the scope is the
  app's.
- **It ships no auth provider and no framework import**, so it stays mountable by
  every app; `@acme/auth` cannot host this half at all, because it ships no React.

## Decisions

See [`docs/adr/`](docs/adr/).
