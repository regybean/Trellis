# Hooks (`@acme/hooks`)

Small, runtime-agnostic React/TanStack-Query helpers shared across features.
No domain knowledge, no auth, no framework specifics — a feature or app composes
these; they never reach back up.

## Language

**Query persister**:
A per-query cache-to-browser mechanism built on TanStack Query's
`experimental_createQueryPersister`, backed by IndexedDB (`idb-keyval`). Restores
a query's last successful data on cold open (instant / offline read), then
background-refetches when online. `createQueryPersister({ keyPrefix, scopeKey,
appVersion, maxAge })` returns the persister to attach to a feature's
`QueryClient` (`defaultOptions.queries.persister`). _Avoid_: "cache" alone
(ambiguous with the in-memory QueryClient cache — this is the persisted copy).

**`persistMeta`**:
The opt-in marker. A query persists **only** if its `meta` includes it
(`useQuery({ …, meta: persistMeta })`). Off by default — unmarked and
non-success queries never touch storage. _Avoid_: "enable persistence globally"
(there is no global switch; it is per query).

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
(with `queryClient.clear()`); slim apps never do.

## Design decisions

**Per-query, not whole-client persistence** — feedback issues one query per
Message, which a whole-client persister would rewrite in full on every Message.
Rationale, storage/security tradeoffs, and the pinned experimental API live in
[ADR 0025](../../../docs/adr/0025-per-query-indexeddb-persister.md).

**The mechanism lives here, the policy lives in the feature/app.** `@acme/hooks`
knows nothing about which queries are sensitive, who the user is, or when logout
happens. Features choose what to mark (`persistMeta`) and how long to keep it
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
