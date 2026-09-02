'use client';

import type { QueryPersister } from '@tanstack/react-query';
import type { AnyRouter } from '@trpc/server';
import type { ReactNode } from 'react';
import { createContext, useContext, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  createTRPCClient,
  httpBatchStreamLink,
  httpLink,
  httpSubscriptionLink,
  isNonJsonSerializable,
  loggerLink,
  splitLink,
} from '@trpc/client';
import { createTRPCContext } from '@trpc/tanstack-react-query';
import SuperJSON from 'superjson';

import {
  clearPersistedCache as clearFeatureStore,
  createQueryPersister,
  persistMeta,
} from './query-persister';

// The client half of a feature's tRPC wiring, authored once. It mirrors the
// server-side `createFeatureTRPC` in `@acme/trpc`: a single factory that owns
// everything identical across features — the `NODE_ENV==='test'` `httpLink`
// switch the MSW seam relies on (ADR 0018), the provider scaffold, and the
// per-query persister wiring (ADR 0025) — and parameterises only what genuinely
// varies: the router type, the `keyPrefix`, the terminal transport link, whether
// the feature has a subscription, and its optional persistence config.
//
// It does NOT own a `QueryClient`. The app mounts exactly one (ADR 0036), so a
// feature provider renders `TRPCProvider` against the client already in context.
// What the per-feature clients used to carry — persister, `gcTime`, `staleTime` —
// is now declared per query via `usePersistedQueryOptions`.
//
// It lives here, not in `@acme/trpc`: this factory ships React and a
// `'use client'` connector, which ADR 0030's platform-purity invariant forbids a
// platform package from carrying. `@acme/hooks` already ships the persister this
// wires in, so it is the honest home.

/**
 * Terminal (non-subscription) data link. `http` is a plain, unbatched link
 * (subscription-only features that never issue queries); `batch-stream` batches
 * and streams query/mutation responses; `blob-batch-stream` adds a split so
 * non-JSON-serialisable inputs (file uploads) bypass SuperJSON and go over a
 * raw `httpLink`, everything else over the batch-stream link.
 */
type Transport = 'http' | 'batch-stream' | 'blob-batch-stream';

/**
 * The three `NODE_ENV` values every feature's env validates to (a zod
 * `z.enum(['development','production','test'])`). Kept as a literal union rather
 * than bare `string` so the MSW test seam (`'test'`) and dev `loggerLink`
 * (`'development'`) switch on a closed set the compiler checks.
 */
type NodeEnv = 'development' | 'production' | 'test';

interface PersisterConfig {
  /**
   * Composed into the persister `buster` (`appVersion:scopeKey`) so a deploy
   * that changes the data shape discards prior snapshots on restore. Chat passes
   * `env.NEXT_PUBLIC_APP_VERSION`; feedback and ingest pin their own data-shape
   * version.
   */
  appVersion: string;
  /**
   * Max age of a persisted entry in ms (chat 7d, feedback and ingest 24h).
   * Required, not defaulted: it is also the `gcTime` every persisted query gets,
   * and the persister needs `gcTime >= maxAge` or an entry is garbage-collected
   * in memory before its stored copy expires.
   */
  maxAge: number;
}

interface FeatureClientOptions {
  /**
   * The feature's identifier. Drives three things at once: the tRPC mount URL
   * (`/api/trpc/<keyPrefix>`), the TanStack-Query `keyPrefix` (namespaces query
   * keys so co-mounted features never collide in the app's one cache), and the
   * persister store name (`rq-<keyPrefix>`).
   */
  keyPrefix: string;
  /**
   * The feature's validated `env.NODE_ENV`. Passed in rather than read here so
   * `@acme/hooks` stays env-agnostic (the feature owns its validated env). Drives
   * the MSW test seam (`'test'`) and the dev-only `loggerLink`.
   */
  nodeEnv: NodeEnv;
  /** Terminal (non-subscription) data link — see {@link Transport}. */
  transport: Transport;
  /**
   * `true` for features with a subscription (chat/ingest/notifications SSE): the
   * links split subscriptions onto `httpSubscriptionLink` — including in tests,
   * where the SSE half stays silent (jsdom can't connect) while queries/mutations
   * still go over the MSW-interceptable `httpLink` (ADR 0018).
   */
  subscriptions?: boolean;
  /**
   * Opt into the ADR 0025 per-query IndexedDB persister. Present ⇒ the provider's
   * `scopeKey` prop builds a persister that `usePersistedQueryOptions()` hands to
   * the queries the feature marks (browser only, and only when IndexedDB exists).
   * Absent ⇒ the feature is always network-only.
   */
  persister?: PersisterConfig;
}

/**
 * The cache policy every persisted query carries, before the persister itself.
 *
 * `staleTime: 0` is load-bearing and belongs HERE rather than on a client
 * default (ADR 0036). On a cold open the persister *is* the queryFn: it restores
 * the snapshot, returns it, then schedules the background refetch only
 * `if (query.isStale())` — a check that reads `staleTime` and ignores
 * `refetchOnMount`. So any `staleTime > 0` serves a restored snapshot WITHOUT
 * revalidating, silently turning stale-while-revalidate into serve-stale. Shipped
 * in the same spread as the persister, the two cannot drift apart.
 */
const persistedQueryDefaults = { meta: persistMeta, staleTime: 0 };

/**
 * Build a feature's `'use client'` tRPC provider + hooks. Returns the provider,
 * `useTRPC` / `useTRPCClient`, a `usePersistedQueryOptions` carrying the cache
 * policy for the feature's persisted queries, and `clearPersistedCache` for the
 * app's logout path.
 */
export function createFeatureClient<TRouter extends AnyRouter>({
  keyPrefix,
  nodeEnv,
  transport,
  subscriptions = false,
  persister,
}: FeatureClientOptions) {
  const isTest = nodeEnv === 'test';

  // The persister exists only in the browser, only when the app supplies a
  // `scopeKey`, and only when this feature opted in — and even then degrades to
  // network-only if IndexedDB is missing (privacy mode). Persistence is a pure
  // read-time optimisation, never a hard dependency.
  const buildPersister = (scopeKey: string | undefined) =>
    persister !== undefined &&
    scopeKey !== undefined &&
    typeof indexedDB !== 'undefined'
      ? createQueryPersister({
          keyPrefix,
          scopeKey,
          appVersion: persister.appVersion,
          maxAge: persister.maxAge,
        })
      : undefined;

  const { useTRPC, useTRPCClient, TRPCProvider } = createTRPCContext<
    TRouter,
    { keyPrefix: true }
  >();

  // The live persister for this mount, or `undefined` when the app opted out
  // (no `scopeKey`) or storage is unavailable. Held in context rather than a
  // module singleton because the scope it is keyed on arrives as a prop.
  const FeaturePersisterContext = createContext<QueryPersister | undefined>(
    undefined,
  );

  /**
   * The full cache policy for one query this feature persists (ADR 0025) —
   * `meta: persistMeta`, the persister, `gcTime` pinned to its `maxAge`, and the
   * `staleTime: 0` that keeps the restore stale-while-revalidate rather than
   * serve-stale. Spread it into the query's options:
   *
   * ```ts
   * const persisted = usePersistedQueryOptions();
   * useQuery(trpc.chat.get.queryOptions({ sessionId }, { retry: false, ...persisted }));
   * ```
   *
   * Without a persister — no `scopeKey`, no IndexedDB, or a feature that never
   * opted in — it degrades to the `meta` mark and `staleTime: 0`, both no-ops:
   * the query is simply network-only, exactly as before.
   */
  const usePersistedQueryOptions = () => {
    const queryPersister = useContext(FeaturePersisterContext);

    if (queryPersister === undefined || persister === undefined) {
      return persistedQueryDefaults;
    }

    return {
      ...persistedQueryDefaults,
      persister: queryPersister,
      gcTime: persister.maxAge,
    };
  };

  /**
   * Empty this feature's persisted cache (`rq-<keyPrefix>`). App-driven: full
   * apps call it — alongside `queryClient.clear()` — on the logout path so a
   * shared machine never leaks one user's data to the next; slim apps have no
   * logout and never call it. Safe no-op if storage is unavailable.
   */
  const clearPersistedCache = () => clearFeatureStore(keyPrefix);

  const buildLinks = () => {
    const url = getBaseUrl() + `/api/trpc/${keyPrefix}`;

    const terminalLink = () => {
      switch (transport) {
        case 'http': {
          return httpLink({ transformer: SuperJSON, url });
        }
        case 'batch-stream': {
          return httpBatchStreamLink({
            transformer: SuperJSON,
            url,
            headers: sourceHeaders,
          });
        }
        case 'blob-batch-stream': {
          return splitLink({
            // File uploads are non-JSON-serialisable: bypass SuperJSON and send
            // the raw body over `httpLink`; everything else batch-streams.
            condition: (op) => isNonJsonSerializable(op.input),
            true: httpLink({
              transformer: {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-return
                serialize: (data) => data,
                deserialize: SuperJSON.deserialize,
              },
              url,
            }),
            false: httpBatchStreamLink({
              transformer: SuperJSON,
              url,
              headers: sourceHeaders,
            }),
          });
        }
      }
    };

    if (isTest) {
      // Tests use a plain `httpLink` so msw-trpc can intercept query/mutation
      // requests; subscription features split the SSE half onto
      // `httpSubscriptionLink` so it stays silent instead of throwing (ADR 0018).
      return subscriptions
        ? [
            splitLink({
              condition: (op) => op.type === 'subscription',
              true: httpSubscriptionLink({ transformer: SuperJSON, url }),
              false: httpLink({ transformer: SuperJSON, url }),
            }),
          ]
        : [httpLink({ transformer: SuperJSON, url })];
    }

    return [
      loggerLink({
        enabled: (op) =>
          nodeEnv === 'development' &&
          op.direction === 'down' &&
          op.result instanceof Error,
      }),
      subscriptions
        ? splitLink({
            condition: (op) => op.type === 'subscription',
            true: httpSubscriptionLink({ transformer: SuperJSON, url }),
            false: terminalLink(),
          })
        : terminalLink(),
    ];
  };

  function TRPCReactProvider(
    props: Readonly<{ children: ReactNode; scopeKey?: string }>,
  ) {
    // The app's one `QueryClient` (ADR 0036). Throws if no `QueryClientProvider`
    // is mounted above — a feature is not mountable on its own, and that failure
    // is deliberately loud where the old "binds to the wrong client" one was
    // silent (#82).
    const queryClient = useQueryClient();
    // Both built once per mount: the persister is keyed on the `scopeKey` the
    // app resolved on the server before first render, and the tRPC client holds
    // its links.
    const [queryPersister] = useState(() => buildPersister(props.scopeKey));
    const [trpcClient] = useState(() =>
      createTRPCClient<TRouter>({ links: buildLinks() }),
    );

    return (
      <FeaturePersisterContext.Provider value={queryPersister}>
        <TRPCProvider
          trpcClient={trpcClient}
          queryClient={queryClient}
          keyPrefix={keyPrefix}
        >
          {props.children}
        </TRPCProvider>
      </FeaturePersisterContext.Provider>
    );
  }

  return {
    TRPCReactProvider,
    useTRPC,
    useTRPCClient,
    usePersistedQueryOptions,
    clearPersistedCache,
  };
}

function sourceHeaders() {
  const headers = new Headers();
  headers.set('x-trpc-source', 'nextjs-react');
  return headers;
}

function getBaseUrl() {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (globalThis.window != undefined) return globalThis.location.origin;
  // eslint-disable-next-line no-restricted-properties
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  // eslint-disable-next-line no-restricted-properties
  return `http://localhost:${process.env.PORT ?? 3000}`;
}
