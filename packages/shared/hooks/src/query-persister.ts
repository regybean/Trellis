import type { PersistedQuery } from '@tanstack/query-persist-client-core';
import type {
  Query,
  QueryFunction,
  QueryFunctionContext,
  QueryKey,
} from '@tanstack/react-query';
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
// would rewrite in full on every Message. See
// [ADR 0001](../docs/adr/0001-per-query-indexeddb-persister.md).

/**
 * Spread into a query's `meta` to opt it into persistence:
 * `useQuery({ queryKey, queryFn, meta: persistMeta })`. Persistence is off by
 * default — only queries a feature marks this way are ever written to storage.
 */
export const persistMeta = { persist: true } satisfies Record<string, unknown>;

/**
 * The persister function `experimental_createQueryPersister` hands back — read
 * off the package rather than re-declared, so a version bump surfaces as a type
 * error in {@link pagedPersister}, the one place that adapts it.
 */
type UpstreamPersisterFn = ReturnType<
  typeof experimental_createQueryPersister<PersistedQuery>
>['persisterFn'];

/**
 * The persister a feature hands to one of its queries, paginated or not.
 *
 * Deliberately NOT react-query's exported `QueryPersister`, which fixes
 * `T = unknown` and `TQueryKey = QueryKey`. That was fine while the persister
 * only ever sat on `defaultOptions.queries`, but it is now attached to
 * individual queries whose data and key types are narrower — and an
 * `unknown`-returning, `readonly unknown[]`-keyed signature does not fit those
 * slots. This alias keeps a `<T, TQueryKey>` of its own so each query
 * instantiates it at its own types.
 *
 * `TPageParam` is the third one, and it is why this is declared rather than
 * read straight off {@link UpstreamPersisterFn}. An infinite query's `persister`
 * slot demands a `queryFn` whose context carries a *concrete* page param plus a
 * direction; upstream's `persisterFn` types its `queryFn` against the
 * non-infinite context, where the page param is a possibly-absent `unknown`.
 * Those are contravariantly incompatible, so the upstream signature fits the
 * plain slot and no infinite one — a feature with a paginated list would have
 * to choose between persistence and pagination. Carrying `TPageParam` here
 * fits both: it resolves to `never` for a plain query and to the query's own
 * page param for an infinite one.
 */
export type FeatureQueryPersister = <T, TQueryKey extends QueryKey, TPageParam>(
  queryFn: QueryFunction<T, TQueryKey, TPageParam>,
  context: QueryFunctionContext<TQueryKey>,
  query: Query,
) => Promise<T>;

/**
 * Re-declare upstream's `persisterFn` at {@link FeatureQueryPersister}, so the
 * one persister a feature builds serves its plain and its paginated queries
 * alike.
 *
 * The adaptation is a single type assertion on the context the persister hands
 * back to the query function, and it is the narrowest statement of a real gap
 * in upstream's own types: `QueryPersister<T, TQueryKey, TPageParam>` types the
 * persister's `context` parameter *without* a page param while typing the
 * `queryFn` it must call *with* one, so the infinite slot cannot be implemented
 * as declared — not here, and not upstream either. At runtime there is no gap:
 * the persister forwards the context it was given, and for an infinite query
 * react-query built that context with the concrete `pageParam` and `direction`
 * the query function expects.
 *
 * Absorbed once, here, rather than as an assertion on every paginated query —
 * where it would read as a shape mismatch in the feature rather than in the
 * dependency.
 */
function pagedPersister(
  persisterFn: UpstreamPersisterFn,
): FeatureQueryPersister {
  return <T, TQueryKey extends QueryKey, TPageParam>(
    queryFn: QueryFunction<T, TQueryKey, TPageParam>,
    context: QueryFunctionContext<TQueryKey>,
    query: Query,
  ) =>
    persisterFn<T, TQueryKey>(
      (forwarded) =>
        queryFn(forwarded as QueryFunctionContext<TQueryKey, TPageParam>),
      context,
      query,
    );
}

interface QueryPersisterOptions {
  /**
   * The feature's existing `keyPrefix` (e.g. `'chat'`, `'feedback'`). Names the
   * per-feature IndexedDB store (`rq-<keyPrefix>`) so mounting several features
   * in one app never collides on a shared storage key.
   */
  keyPrefix: string;
  /**
   * App-supplied per-user scope. Full apps pass the signed-in user id;
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
}: QueryPersisterOptions) {
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

  return pagedPersister(persisterFn);
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
