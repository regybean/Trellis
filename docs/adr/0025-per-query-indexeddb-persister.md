# Per-query IndexedDB persister for offline read of chat & feedback

Operators reload or reopen an app and stare at empty Conversation History, blank
Messages, and flickering thumbs-up/down Feedback buttons until the network
responds — worst on a slow link, unusable offline. These are the surfaces they
revisit most and the slowest to reappear. The fix is to persist the relevant
TanStack Query cache to the browser and restore it instantly on cold open, then
background-refetch when online (stale-while-revalidate). This ADR records the
load-bearing choices behind the shared mechanism (`@acme/hooks`); the features
that opt in (chat, feedback, and — since #216 — ingest) and the app-supplied scope wiring are separate
tickets that compose it.

> **Amended by [ADR 0036](0036-one-app-owned-query-client.md).** This ADR was
> written when each feature owned a `QueryClient`, and said "attach the persister
> to its `QueryClient`". Apps now mount a single `QueryClient`, and a feature
> attaches its persister — with the `gcTime` and `staleTime: 0` that make it
> correct — to the individual queries it persists, via
> `usePersistedQueryOptions()`. Everything else below stands; the sentences that
> assumed the per-feature client are corrected in place.

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
it on by attaching the persister to the specific queries to persist, along with
the `meta` mark that gates it (`meta: persistMeta`). The persister's
`filters` predicate (`query.meta?.persist === true`) is the gate — only marked,
successful queries are ever written. Sensitive/volatile queries
(credits/subscription, the `chat.stream` subscription, in-flight Turn state) are
simply never marked.

> **Note (amended by #115): `chat.get` transiently holds an in-flight Turn.**
> As of the chat Turn-lifecycle simplification, `chat.get` is the single source
> of truth for the rendered Messages: the optimistic user Message and the
> assistant's streaming deltas are written into that query's cache, not a
> separate client-only list. Because `chat.get` is `persistMeta`-marked, the
> persister therefore _briefly_ writes the in-flight assistant partial (a
> `loading` bubble whose text grows delta-by-delta) to IndexedDB during a Turn.
> This is accepted: it is the same auth-scoped PII the store already holds, it is
> overwritten by the settled Message on the terminal, and a cold reload
> reconciles it — a resumed Turn re-attaches to the durable Stream, and a Turn
> that wedged (worker died, lock TTL lapsed) is surfaced as an error rather than
> a stuck spinner (`useChat` wedged-Turn detection). No new data _class_ is
> persisted; only its timing changed.
>
> Because only _successful fetches_ are persisted, but chat's caches are also
> written optimistically via `setQueryData` (the streamed Messages in `chat.get`;
> the "New chat" row in `chat.list`), the restored snapshot lags reality: a
> first-Turn Conversation's `chat.get` is the empty greeting load (`[]`) stamped
> with a recent `dataUpdatedAt` — "fresh" under `staleTime` yet wrong — and
> `chat.list` is the list from _before_ the new thread. So a quick refresh
> rendered a stale empty message pane and a sidebar missing the just-created
> Conversation.
>
> The revalidation lever is **`staleTime: 0`** on the persisted query, NOT
> `refetchOnMount`. This is a subtle, load-bearing interaction with the persister
> and was mis-diagnosed once (a `refetchOnMount: 'always'` default that did
> nothing): on a cold open the persister _is_ the queryFn — it restores the
> snapshot and returns it, then schedules the background refetch only
> `if (query.isStale())`, a check that reads `staleTime` and ignores
> `refetchOnMount` (the observer's mount-fetch is fully consumed by the persister
> handing back cached data; there is no second, independent network hit). So any
> `staleTime > 0` serves a snapshot younger than it without revalidating.
> `staleTime: 0` makes every restored entry stale, so the persister always fires
> the refetch — instant paint preserved, server truth always revalidated.
>
> That background refetch is a **floating `query.fetch()`** inside the persister,
> and `Query.fetch()` re-throws on failure, so a failed revalidation (offline, or
> a 5xx) became an _unhandled rejection_ — now on every offline cold open, since
> `staleTime: 0` always fires it. The persister is **patched** (`pnpm patch`,
> `patches/@tanstack__query-persist-client-core@5.90.2.patch`) to `.catch()` that
> one call: the restored data is already shown and a failed background
> revalidation must degrade silently. Re-verify the patch on any persister bump.

**Per-feature storage key.** Each feature's cache lives in its own IndexedDB
store, `rq-<keyPrefix>` (e.g. `rq-chat`, `rq-feedback`, `rq-ingest`), derived from the
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

- Short `maxAge` per feature (chat 7 days, feedback and ingest 24 hours) bounds how long a
  snapshot lives; `gcTime >= maxAge` on the persisted query.
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
- A `pnpm patch` on the persister (`.catch()` on its background-revalidation
  fetch) is load-bearing and pinned to `5.90.2`: line offsets shift on a bump, so
  regenerate and re-verify the patch whenever the persister version moves. It is
  only reachable because chat and ingest set `staleTime: 0` (so the revalidation
  always fires) — a consumer that leaves `staleTime > 0` never hits the floating
  fetch.
- `staleTime: 0` on every persisted query means it revalidates on every mount
  (the cost of correct stale-while-revalidate through the persister): more
  network chatter than a non-zero `staleTime`, accepted on surfaces where
  freshness matters and the persister still gives the instant paint. It is not
  optional for an opting-in query — any `staleTime > 0` silently converts
  stale-while-revalidate into serve-stale, which is why
  [ADR 0036](0036-one-app-owned-query-client.md) ships the two together in one
  spread rather than leaving them two files apart.
- Opting a feature in is now a small, uniform step: declare a `persister` in
  `createFeatureClient`, spread `usePersistedQueryOptions()` into the queries
  that should persist, and expose `clearPersistedCache` for the app's logout
  path.
- Server-driven cache invalidation, offline writes, and cross-tab sync are
  explicitly out of scope; the `chat.stream` subscription is the existing seam a
  future invalidation effort would extend.
