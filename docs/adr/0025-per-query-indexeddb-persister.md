# Per-query IndexedDB persister for offline read of chat & feedback

Operators reload or reopen an app and stare at empty Conversation History, blank
Messages, and flickering thumbs-up/down Feedback buttons until the network
responds — worst on a slow link, unusable offline. These are the surfaces they
revisit most and the slowest to reappear. The fix is to persist the relevant
TanStack Query cache to the browser and restore it instantly on cold open, then
background-refetch when online (stale-while-revalidate). This ADR records the
load-bearing choices behind the shared mechanism (`@acme/hooks`); the features
that opt in (chat, feedback) and the app-supplied scope wiring are separate
tickets that compose it.

## Decision

**Per-query persistence, not whole-client.** Built on TanStack Query's
`experimental_createQueryPersister` (each query written under its own hash,
lazily), not the whole-client `PersistQueryClientProvider`. The deciding factor
is feedback: `feedback.forMessage` issues one query per rendered assistant
Message, so a whole-client persister would rewrite the entire cache blob on every
Message. `@acme/hooks` owns the mechanism (`createQueryPersister` +
`clearPersistedCache`); chat and feedback compose it rather than re-implementing
storage.

**IndexedDB via `idb-keyval`.** Async (no main-thread jank persisting many
per-Message queries), above the ~5MB Web Storage cap, and — with identity
`serialize`/`deserialize` — no JSON step, so structured-cloneable values
(`Date`s in Messages) survive the round-trip. This is a performance/quota choice,
**not** a security one: IndexedDB is as readable by same-origin JS as
localStorage.

**Opt-in per feature, per query.** Persistence is off by default. A feature turns
it on by attaching the persister to its `QueryClient` and marking the specific
queries to persist via query `meta` (`meta: persistMeta`). The persister's
`filters` predicate (`query.meta?.persist === true`) is the gate — only marked,
successful queries are ever written. Sensitive/volatile queries
(credits/subscription, the `chat.stream` subscription, in-flight Turn state) are
simply never marked.

**Per-feature storage key.** Each feature's cache lives in its own IndexedDB
store, `rq-<keyPrefix>` (e.g. `rq-chat`, `rq-feedback`), derived from the
feature's existing `keyPrefix`. Mounting several features in one app never
collides on a shared key.

**App-supplied scope; buster = `appVersion:scopeKey`.** Features must not import
Clerk. The app passes a `scopeKey` string into each opting-in feature's provider:
full (Clerk) apps pass the signed-in user id via the `@acme/auth` seam; slim
(no-auth) apps pass the constant `'anon'`. The persister composes
`buster = appVersion + scopeKey`, so a different user or a new deploy never
rehydrates a prior snapshot (buster mismatch discards it on restore). This keeps
features auth-agnostic and mountable in both app families (respects
[ADR 0010](0010-slim-no-auth-apps.md)).

**App-driven logout-clear.** `clearPersistedCache(keyPrefix)` empties a feature's
store. Full apps call it — alongside `queryClient.clear()` — on the Clerk logout
path so a shared machine never leaks one user's history/feedback to the next.
Slim apps have no logout and never call it.

**Graceful degradation.** If IndexedDB is unavailable or a persist/restore
throws, queries fall back to network-only — identical to today. Persistence is a
pure read-time optimisation, never a hard dependency.

### Pinned dependency (the experimental-API risk)

`experimental_createQueryPersister` lives in `@tanstack/query-persist-client-core`
and carries the `experimental_` prefix, so its contract can change under us.
Mitigations:

- **Pinned exact** in the catalog (`5.90.2`, no caret) so a patch bump can't
  change the persister silently.
- **Single `query-core`.** This package is versioned independently of
  `@tanstack/react-query` and its `@tanstack/query-core` dependency rarely lines
  up (e.g. react-query 5.90.16 → core 5.90.16, but persist 5.90.2 → core 5.90.2).
  Two `query-core` copies make the two `QueryClient` types nominally incompatible
  (private-field brand), so the persister won't fit react-query's
  `queries.persister`. A pnpm `overrides` pin forces one copy — set to
  react-query's exact core (`5.90.16`). **Bump the override in lockstep whenever
  react-query's resolved `query-core` moves**; a mismatch fails typecheck loudly.
- **Documented fallback.** If the experimental API breaks, the stable
  whole-client `PersistQueryClientProvider` is the retreat — at the cost of the
  per-Message feedback write pattern this design exists to support.

## Security posture — PII at rest

Chat Messages and Feedback are auth-scoped PII. Both IndexedDB and localStorage
are readable by any same-origin JS, so a single XSS exfiltrates the store;
encryption-at-rest in the browser buys little (the key would sit next to the
data). The accepted posture is **short-lived, scoped, clearable** rather than
encrypted:

- Short `maxAge` per feature (chat 7 days, feedback 24 hours) bounds how long a
  snapshot lives; `gcTime >= maxAge` on the QueryClient.
- `scopeKey` buster prevents cross-account reads in the same browser.
- App-driven logout-clear removes a departing user's data on shared machines.

**Slim apps** persist too (the load pain is data-load, not auth) under
`scopeKey: 'anon'`. The tradeoff — single-user PII at rest with no logout to
clear it — is explicitly accepted; `buster` still discards on version change.
This is called out here rather than left implicit precisely because it is
load-bearing.

## Considered and rejected

- **Whole-client `PersistQueryClientProvider`.** Rewrites the full cache blob on
  every write — pathological against feedback's one-query-per-Message pattern.
  Kept only as the fallback if the experimental per-query API breaks.
- **localStorage / Web Storage.** Synchronous (janks the main thread on many
  per-Message writes), ~5MB cap, and forces a JSON step that flattens `Date`s.
- **Hand-rolled persister.** Reinvents restore/expiry/buster logic the official
  package already provides; more surface to get subtly wrong.
- **Feature owns the auth scope.** Would drag Clerk into feature packages and
  break the slim (no-auth) subset. The app supplies `scopeKey` instead.
- **Encrypt the store.** Same-origin JS reads the key too; adds complexity for
  negligible gain against the actual threat (XSS). Short `maxAge` + scope +
  logout-clear is the honest mitigation.
- **Aligning react-query and the persister on one version instead of an override.**
  Their version lines and `query-core` pins almost never coincide, so this would
  mean frequent, awkward version gymnastics; a single `overrides` pin is simpler.

## Status

accepted

## Consequences

- `@acme/hooks` gains a frontend test setup (jsdom + `fake-indexeddb`) and its
  first real tests — the persister contract is verified here once, at the
  `QueryClient` + persister level.
- The `@tanstack/query-core` override is load-bearing and coupled to
  react-query's version: bump it whenever react-query's `query-core` moves, or
  typecheck fails.
- Opting a feature in is now a small, uniform step: attach `createQueryPersister`
  to its `QueryClient`, mark queries with `persistMeta`, and expose
  `clearPersistedCache` for the app's logout path.
- Server-driven cache invalidation, offline writes, and cross-tab sync are
  explicitly out of scope; the `chat.stream` subscription is the existing seam a
  future invalidation effort would extend.
