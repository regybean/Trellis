import type { PersistedQuery } from '@tanstack/query-persist-client-core';
import type { QueryPersister } from '@tanstack/react-query';
import { experimental_createQueryPersister } from '@tanstack/query-persist-client-core';
import { clear, createStore, del, get, set } from 'idb-keyval';

// The single shared mechanism that opting-in features compose to persist their
// TanStack Query cache to the browser for instant / offline read. It is a pure
// read-time optimisation: if IndexedDB is unavailable or a persist/restore
// fails, queries fall back to network-only, exactly as without a persister.
//
// Per-query (NOT whole-client): built on `experimental_createQueryPersister`,
// so each query is written under its own hash, lazily. The deciding factor is
// feedback's one-query-per-Message pattern, which a whole-client persister
// would rewrite in full on every Message. See ADR 0025.

/**
 * Spread into a query's `meta` to opt it into persistence:
 * `useQuery({ queryKey, queryFn, meta: persistMeta })`. Persistence is off by
 * default — only queries a feature marks this way are ever written to storage.
 */
export const persistMeta = { persist: true } satisfies Record<string, unknown>;

interface QueryPersisterOptions {
  /**
   * The feature's existing `keyPrefix` (e.g. `'chat'`, `'feedback'`). Names the
   * per-feature IndexedDB store (`rq-<keyPrefix>`) so mounting several features
   * in one app never collides on a shared storage key.
   */
  keyPrefix: string;
  /**
   * App-supplied per-user scope. Full (Clerk) apps pass the signed-in user id;
   * slim (no-auth) apps pass a constant `'anon'`. Composed into `buster` so a
   * different user never rehydrates a prior user's snapshot.
   */
  scopeKey: string;
  /**
   * App version. Composed into `buster` so a deploy that changes the data shape
   * invalidates every persisted cache rather than rehydrating an incompatible
   * snapshot.
   */
  appVersion: string;
  /**
   * Max age of a persisted entry in ms. Older entries are discarded on restore
   * rather than shown. Defaults to 24h; features that keep data longer (chat
   * history) pass a larger value. Keep `gcTime >= maxAge` on the QueryClient.
   */
  maxAge?: number;
}

/** IndexedDB store for a feature's persisted cache — `rq-<keyPrefix>`. */
function featureStore(keyPrefix: string) {
  return createStore(`rq-${keyPrefix}`, 'cache');
}

/**
 * Build a per-query persister for a feature's `QueryClient`. Attach the result
 * to `defaultOptions.queries.persister`; only queries marked with `persistMeta`
 * are actually stored (via the `filters` predicate).
 *
 * Storage is IndexedDB via `idb-keyval` (async — no main-thread jank persisting
 * many per-Message queries; above the ~5MB Web Storage cap). `serialize` /
 * `deserialize` are identity so entries are stored as structured-cloned objects
 * (no JSON step; `Date`s and other structured-cloneable values survive).
 */
export function createQueryPersister({
  keyPrefix,
  scopeKey,
  appVersion,
  maxAge,
}: QueryPersisterOptions): QueryPersister {
  const store = featureStore(keyPrefix);

  const { persisterFn } = experimental_createQueryPersister<PersistedQuery>({
    storage: {
      getItem: (key) => get(key, store),
      setItem: (key, value) => set(key, value, store),
      removeItem: (key) => del(key, store),
    },
    // A different user (scopeKey) or a new deploy (appVersion) never rehydrates
    // a prior snapshot — the buster mismatch discards it on restore.
    buster: `${appVersion}:${scopeKey}`,
    maxAge,
    serialize: (persistedQuery) => persistedQuery,
    deserialize: (persistedQuery) => persistedQuery,
    // Opt-in per query: unmarked and non-success queries never land in storage.
    filters: { predicate: (query) => query.meta?.persist === true },
  });

  return persisterFn;
}

/**
 * Empty a feature's persisted cache (`rq-<keyPrefix>`). App-driven: the full
 * apps call this — alongside `queryClient.clear()` — on logout, so a shared
 * machine never leaks one user's chat history or feedback to the next. Slim
 * apps have no logout and never call it. Safe no-op degradation: a storage
 * failure here never blocks logout.
 */
export function clearPersistedCache(keyPrefix: string) {
  return clear(featureStore(keyPrefix));
}
