# Hooks (`@acme/hooks`)

Small, runtime-agnostic React/TanStack-Query helpers shared across features.
No domain knowledge, no framework specifics, and **no auth provider** — a feature
or app composes these; they never reach back up.

"No auth provider" is narrower than the "no auth" this charter used to claim, and
the distinction is the point: the package now ships the _client_ half of the auth
seam (`AuthStatusProvider` / `useAuthStatus`), which is a plain React context
carrying three fields. It knows nothing about Better Auth or sessions —
the app resolves those and feeds the result in. That is what keeps the slim,
no-auth apps' graph free of a provider (ADR 0010) while letting `@acme/billing`
gate its viewer-scoped queries on something.

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

The _app_ owns resolution (ADR 0003) and mounts the provider — both full apps map
Better Auth's `useSession`, seeded from the id their server render already
resolved. `useAuthStatus` **throws** without a provider rather than defaulting to
signed-out: the silent version of that bug is a feature whose queries never
enable, which looks exactly like a logged-out user. Lives here rather than in
`@acme/auth` because that package ships no React (ADR 0034), and the substrate
must not pull a provider into the slim apps' graph (ADR 0010).
_Avoid_: "the session" (features never see one — a session is a database row on
the server)

**`createAppQueryClient` / `AppQueryClientProvider`**:
The app's single `QueryClient` and, for the Next.js apps, the provider that
mounts it at the root of `layout.tsx` ([ADR 0036](../../../docs/adr/0036-one-app-owned-query-client.md)).
Every feature's queries live in it, namespaced by tRPC's `keyPrefix`, so
`useQuery` has exactly one client to resolve to. It carries only what is true for
every feature — the SuperJSON `dehydrate`/`hydrate` transformer and a
`shouldDehydrateQuery` widened to pending queries for streamed SSR — and
deliberately **no `staleTime`**: a non-zero app default would silently break every
persisted query. The TanStack apps don't use the provider; their router already
owns a client for `setupRouterSsrQueryIntegration` and calls the factory in
`router.tsx`. _Avoid_: putting feature policy here (that is per query, below).

**`createFeatureClient`**:
The client half of a feature's tRPC wiring, authored once — the mirror of
`createFeatureTRPC` in `@acme/trpc`. Returns a feature's `'use client'`
`FeatureTRPCProvider` — a tRPC provider, **not** a `QueryClientProvider`, which
is the whole point of the name — plus `useTRPC` / `useTRPCClient`,
`usePersistedQueryOptions`, and `clearPersistedCache`. It owns everything
identical across features — the `NODE_ENV==='test'` `httpLink` switch the MSW seam
relies on ([ADR 0018](../../../docs/adr/0018-frontend-test-doctrine.md)), the
provider tree, and the persister wiring — and parameterises only what varies:
`keyPrefix` (drives the endpoint, the query-key prefix, and the `rq-<keyPrefix>`
persister store), `nodeEnv`, the `transport` (`http` / `batch-stream` /
`blob-batch-stream` for file uploads), whether it has `subscriptions`, and an
optional `persister` (`appVersion` + `maxAge`). It lives here, not in
`@acme/trpc`, because it ships React + a `'use client'` connector, which ADR
0030's platform-purity invariant forbids a platform package from carrying. All
five slices — chat, feedback, ingest, notifications, billing — mount through it.
It renders **no `QueryClientProvider`**: the provider reads the app's client from
context and throws without one, so a feature is not mountable on its own.
_Avoid_: re-authoring the test-seam/provider scaffold per feature (the divergence
this retired); giving a feature its own `QueryClient` (#82 — the bug ADR 0036
closed).

**`usePersistedQueryOptions`**:
The cache policy for one query a feature persists, as a fragment to spread into
that query's options: `meta: persistMeta`, the feature's `persister`, `gcTime`
pinned to its `maxAge`, and `staleTime: 0`. Shipping all four together is the
point — `staleTime: 0` is what keeps a restore stale-while-revalidate instead of
serve-stale, and as a client-level default it could drift away from the persister
it belongs to (ADR 0036). With no persister (no `scopeKey`, no IndexedDB, or a
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
`queryClient.clear()` it pairs with empties the whole cache anyway (ADR 0036).

## Design decisions

**Per-query, not whole-client persistence** — feedback issues one query per
Message, which a whole-client persister would rewrite in full on every Message.
Rationale, storage/security tradeoffs, and the pinned experimental API live in
[ADR 0025](../../../docs/adr/0025-per-query-indexeddb-persister.md).

**The mechanism lives here, the policy lives in the feature/app.** `@acme/hooks`
knows nothing about which queries are sensitive, which provider authenticated the
viewer, or when logout happens — `AuthStatus` is the shape of that ignorance, not
an exception to it. Features choose what to mark (`persistMeta`) and how long to keep it
(`maxAge`); apps supply `scopeKey` and drive `clearPersistedCache`. This keeps
the helper runtime- and auth-agnostic, so it composes in both the full and slim
app families.

**Graceful degradation** — if IndexedDB is unavailable or a persist/restore
fails, queries fall back to network-only. Persistence is a pure read-time
optimisation, never a hard dependency.

## Tests

Frontend-library: jsdom + `fake-indexeddb` (jsdom ships no IndexedDB). The
persister is tested once at the `QueryClient` + persister level — round-trip,
selective (only `persistMeta` queries), buster/`scopeKey` discard, and
`clearPersistedCache` — asserting observable behaviour, never the persister's
internals (ADR 0018).
