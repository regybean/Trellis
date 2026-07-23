'use client';

import type { QueryClient } from '@tanstack/react-query';
import type React from 'react';
import { useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import {
  createTRPCClient,
  httpBatchStreamLink,
  httpLink,
  httpSubscriptionLink,
  loggerLink,
  splitLink,
} from '@trpc/client';
import { createTRPCContext } from '@trpc/tanstack-react-query';
import SuperJSON from 'superjson';

import {
  clearPersistedCache as clearFeatureStore,
  createQueryPersister,
} from '@acme/hooks';

import type { AppRouter } from '../api/root';
import { env } from '../env';
import {
  createQueryClient,
  FEEDBACK_PERSIST_MAX_AGE,
  FEEDBACK_PERSIST_VERSION,
} from './query-client';

// The feature's persisted cache lives under `rq-feedback` (ADR 0025), derived
// from this keyPrefix so mounting alongside other features never collides.
const KEY_PREFIX = 'feedback';

/**
 * Build the per-query persister for a given app-supplied scope, or `undefined`
 * when persistence must stay off — no scope, or IndexedDB unavailable (e.g. some
 * privacy modes / SSR). In every off case the feature runs network-only, exactly
 * as before: persistence is a pure optimisation, never a hard dependency.
 */
const persisterFor = (scopeKey: string | undefined) =>
  scopeKey && typeof indexedDB !== 'undefined'
    ? createQueryPersister({
        keyPrefix: KEY_PREFIX,
        scopeKey,
        appVersion: FEEDBACK_PERSIST_VERSION,
        maxAge: FEEDBACK_PERSIST_MAX_AGE,
      })
    : undefined;

let clientQueryClientSingleton: QueryClient | undefined;
const getQueryClient = (scopeKey: string | undefined) => {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (globalThis.window == undefined) {
    return createQueryClient(); // Server: always make a new query client
  }
  const persister = persisterFor(scopeKey);
  // Tests: never reuse the singleton, or cache leaks across test cases.
  if (env.NODE_ENV === 'test') {
    return createQueryClient(persister);
  }
  // Browser: use singleton pattern to keep the same query client
  clientQueryClientSingleton ??= createQueryClient(persister);
  return clientQueryClientSingleton;
};

export const { useTRPC, TRPCProvider } = createTRPCContext<
  AppRouter,
  { keyPrefix: true }
>();

/**
 * Empty the feedback feature's persisted cache (`rq-feedback`). App-driven: the
 * full apps call this — alongside `queryClient.clear()` — on the Clerk logout
 * path so a shared machine never leaks one user's Rating state to the next. Slim
 * apps have no logout and never call it. Safe no-op if storage is unavailable.
 */
export const clearPersistedCache = () => clearFeatureStore(KEY_PREFIX);

export function TRPCReactProvider(
  props: Readonly<{
    children: React.ReactNode;
    /**
     * App-supplied per-user scope. Full (Clerk) apps pass the signed-in user id
     * via the `@acme/auth` seam; slim (no-auth) apps pass a constant `'anon'`.
     * When absent, persistence stays off and the feature runs network-only.
     */
    scopeKey?: string;
  }>,
) {
  const queryClient = getQueryClient(props.scopeKey);

  const [trpcClient] = useState(() =>
    createTRPCClient<AppRouter>({
      // In tests we use a plain httpLink so msw-trpc can intercept requests
      // cleanly (batching/streaming links are harder to mock).
      links:
        env.NODE_ENV === 'test'
          ? [
              httpLink({
                transformer: SuperJSON,
                url: getBaseUrl() + '/api/trpc/feedback',
              }),
            ]
          : [
              loggerLink({
                enabled: (op) =>
                  env.NODE_ENV === 'development' &&
                  op.direction === 'down' &&
                  op.result instanceof Error,
              }),
              splitLink({
                condition: (op) => op.type === 'subscription',
                true: httpSubscriptionLink({
                  url: getBaseUrl() + '/api/trpc/feedback',
                  transformer: SuperJSON,
                }),
                false: httpBatchStreamLink({
                  transformer: SuperJSON,
                  url: getBaseUrl() + '/api/trpc/feedback',
                  headers: () => {
                    const headers = new Headers();
                    headers.set('x-trpc-source', 'nextjs-react');
                    return headers;
                  },
                }),
              }),
            ],
    }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider
        trpcClient={trpcClient}
        queryClient={queryClient}
        keyPrefix="feedback"
      >
        {props.children}
      </TRPCProvider>
    </QueryClientProvider>
  );
}

function getBaseUrl() {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (globalThis.window != undefined) return globalThis.location.origin;
  // eslint-disable-next-line no-restricted-properties
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  // eslint-disable-next-line no-restricted-properties
  return `http://localhost:${process.env.PORT ?? 3000}`;
}
