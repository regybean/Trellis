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
  isNonJsonSerializable,
  loggerLink,
  splitLink,
} from '@trpc/client';
import { createTRPCContext } from '@trpc/tanstack-react-query';
import SuperJSON from 'superjson';

import {
  clearPersistedCache as clearHookPersistedCache,
  createQueryPersister,
} from '@acme/hooks';

import type { AppRouter } from '../api/root';
import { env } from '../env';
import { CHAT_MAX_AGE, createQueryClient } from './query-client';

// Chat's per-feature identifier: names its own IndexedDB store `rq-chat`, so
// mounting alongside other opted-in features never collides on a shared key.
const CHAT_KEY_PREFIX = 'chat';

/**
 * Empty chat's persisted cache (`rq-chat`). App-driven: the full apps call this
 * — alongside `queryClient.clear()` — on the Clerk logout path so a shared
 * machine never leaks one user's Conversations to the next; slim apps have no
 * logout and never call it. Safe no-op degradation on storage failure.
 */
export const clearChatPersistedCache = () =>
  clearHookPersistedCache(CHAT_KEY_PREFIX);

let clientQueryClientSingleton: QueryClient | undefined;
const getQueryClient = (scopeKey?: string) => {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (globalThis.window == undefined) {
    return createQueryClient(); // Server: always make a new query client, no persister
  }
  // The persister exists only when the app supplies a per-user `scopeKey`.
  // Absent ⇒ chat behaves exactly as before (network-only) — graceful
  // degradation, not a hard dependency.
  const persister =
    scopeKey === undefined
      ? undefined
      : createQueryPersister({
          keyPrefix: CHAT_KEY_PREFIX,
          scopeKey,
          appVersion: env.NEXT_PUBLIC_APP_VERSION,
          maxAge: CHAT_MAX_AGE,
        });
  // In tests, avoid singleton to prevent cross-test cache pollution
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

// https://discord-questions.trpc.io/m/1343947836143960066
export function TRPCReactProvider(
  props: Readonly<{ children: React.ReactNode; scopeKey?: string }>,
) {
  const queryClient = getQueryClient(props.scopeKey);

  // We only console.error in development not production
  const [trpcClient] = useState(() =>
    createTRPCClient<AppRouter>({
      links:
        env.NODE_ENV === 'test'
          ? [
              // In tests, split subscriptions from query/mutation so that:
              // - query/mutation go through httpLink (MSW-interceptable, ADR 0018)
              // - subscriptions go through httpSubscriptionLink (won't throw;
              //   MSW can't intercept SSE but the link stays silent while
              //   connecting — tests assert the synchronous optimistic state).
              splitLink({
                condition: (op) => op.type === 'subscription',
                true: httpSubscriptionLink({
                  transformer: SuperJSON,
                  url: getBaseUrl() + '/api/trpc/chat',
                }),
                false: httpLink({
                  transformer: SuperJSON,
                  url: getBaseUrl() + '/api/trpc/chat',
                }),
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
                  url: getBaseUrl() + `/api/trpc/chat`,
                  transformer: SuperJSON, // may be wrong
                }),
                false: splitLink({
                  condition: (op) => isNonJsonSerializable(op.input),
                  true: httpLink({
                    transformer: {
                      // request - convert data before sending to the tRPC server
                      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
                      serialize: (data) => data,
                      // response - convert the tRPC response before using it in client
                      deserialize: SuperJSON.deserialize, // or your other transformer
                    },
                    url: getBaseUrl() + '/api/trpc/chat',
                  }),
                  false: httpBatchStreamLink({
                    transformer: SuperJSON,
                    url: getBaseUrl() + '/api/trpc/chat',
                    headers: () => {
                      const headers = new Headers();
                      headers.set('x-trpc-source', 'nextjs-react');
                      return headers;
                    },
                  }),
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
        keyPrefix="chat"
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
