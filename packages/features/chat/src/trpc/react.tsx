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

import type { AppRouter } from '../api/root';
import { env } from '../env';
import { createQueryClient } from './query-client';

let clientQueryClientSingleton: QueryClient | undefined;
const getQueryClient = () => {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (globalThis.window == undefined) {
    return createQueryClient(); // Server: always make a new query client
  }
  // In tests, avoid singleton to prevent cross-test cache pollution
  if (env.NODE_ENV === 'test') {
    return createQueryClient();
  }
  // Browser: use singleton pattern to keep the same query client
  clientQueryClientSingleton ??= createQueryClient();
  return clientQueryClientSingleton;
};

export const { useTRPC, TRPCProvider } = createTRPCContext<
  AppRouter,
  { keyPrefix: true }
>();

// https://discord-questions.trpc.io/m/1343947836143960066
export function TRPCReactProvider(
  props: Readonly<{ children: React.ReactNode }>,
) {
  const queryClient = getQueryClient();

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
