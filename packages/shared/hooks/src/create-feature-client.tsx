'use client';

import type { QueryClient, QueryPersister } from '@tanstack/react-query';
import type { AnyRouter } from '@trpc/server';
import type { ReactNode } from 'react';
import { createContext, useContext, useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
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
} from './query-persister';

// The client half of a feature's tRPC wiring, authored once. It mirrors the
// server-side `createFeatureTRPC` in `@acme/trpc`: a single factory that owns
// everything identical across features — the SSR `getQueryClient` singleton, the
// `NODE_ENV==='test'` `httpLink` switch the MSW seam relies on (ADR 0018), and
// the provider scaffold — and parameterises only what genuinely varies: the
// router type, the `keyPrefix`, the terminal transport link, whether the feature
// has a subscription, and the optional per-query persister (ADR 0025).
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
   * `env.NEXT_PUBLIC_APP_VERSION`; feedback pins its own data-shape version.
   */
  appVersion: string;
  /** Max age of a persisted entry in ms (chat 7d, feedback 24h). */
  maxAge?: number;
}

interface FeatureClientOptions {
  /**
   * The feature's identifier. Drives three things at once: the tRPC mount URL
   * (`/api/trpc/<keyPrefix>`), the TanStack-Query `keyPrefix` (namespaces query
   * keys so co-mounted feature providers never collide), and the persister store
   * name (`rq-<keyPrefix>`).
   */
  keyPrefix: string;
  /**
   * The feature's validated `env.NODE_ENV`. Passed in rather than read here so
   * `@acme/hooks` stays env-agnostic (the feature owns its validated env). Drives
   * the MSW test seam (`'test'`) and the dev-only `loggerLink`.
   */
  nodeEnv: NodeEnv;
  /**
   * The feature's own `QueryClient` factory — `staleTime`, `dehydrate`, and
   * `gcTime` differ per feature, so the factory can't own it. Receives the
   * persister (or `undefined`) to attach.
   */
  createQueryClient: (persister?: QueryPersister) => QueryClient;
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
   * `scopeKey` prop wires a persister into the `QueryClient` (browser only, and
   * only when IndexedDB exists). Absent ⇒ the feature is always network-only.
   */
  persister?: PersisterConfig;
}

/**
 * Build a feature's `'use client'` tRPC provider + hooks. Returns the provider
 * plus `useTRPC` / `useTRPCClient`, a `useFeatureQueryClient` that pins the
 * feature's own `QueryClient` (so a feature's queries never run on a foreign,
 * persister-less client when providers are nested — #82), and
 * `clearPersistedCache` for the app's logout path.
 */
export function createFeatureClient<TRouter extends AnyRouter>({
  keyPrefix,
  nodeEnv,
  createQueryClient,
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

  let clientQueryClientSingleton: QueryClient | undefined;
  const getQueryClient = (scopeKey: string | undefined) => {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (globalThis.window == undefined) {
      return createQueryClient(); // Server: always a fresh client, no persister.
    }
    const persisterFn = buildPersister(scopeKey);
    // Tests: never reuse the singleton, or cache leaks across cases.
    if (isTest) {
      return createQueryClient(persisterFn);
    }
    // Browser: singleton so every mount shares one client.
    clientQueryClientSingleton ??= createQueryClient(persisterFn);
    return clientQueryClientSingleton;
  };

  const { useTRPC, useTRPCClient, TRPCProvider } = createTRPCContext<
    TRouter,
    { keyPrefix: true }
  >();

  // Pins the feature's own client so hooks can pass it explicitly to `useQuery`
  // rather than binding to the nearest `QueryClientProvider` in context — apps
  // nest several feature providers, and the persister lives on THIS client (#82).
  const FeatureQueryClientContext = createContext<QueryClient | undefined>(
    undefined,
  );
  const useFeatureQueryClient = () => {
    const client = useContext(FeatureQueryClientContext);
    if (client === undefined) {
      throw new Error(
        'useFeatureQueryClient must be used within the feature TRPCReactProvider',
      );
    }
    return client;
  };

  /**
   * Empty this feature's persisted cache (`rq-<keyPrefix>`). App-driven: full
   * apps call it — alongside `queryClient.clear()` — on the logout path so
   * a shared machine never leaks one user's data to the next; slim apps have no
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
    const queryClient = getQueryClient(props.scopeKey);
    const [trpcClient] = useState(() =>
      createTRPCClient<TRouter>({ links: buildLinks() }),
    );

    return (
      <FeatureQueryClientContext.Provider value={queryClient}>
        <QueryClientProvider client={queryClient}>
          <TRPCProvider
            trpcClient={trpcClient}
            queryClient={queryClient}
            keyPrefix={keyPrefix}
          >
            {props.children}
          </TRPCProvider>
        </QueryClientProvider>
      </FeatureQueryClientContext.Provider>
    );
  }

  return {
    TRPCReactProvider,
    useTRPC,
    useTRPCClient,
    useFeatureQueryClient,
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
