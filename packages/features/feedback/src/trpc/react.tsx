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

import type { AppRouter } from '../api/root';
import { env } from '../env';
import { createQueryClient } from './query-client';

let clientQueryClientSingleton: QueryClient | undefined;
const getQueryClient = () => {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (globalThis.window == undefined) {
    return createQueryClient(); // Server: always make a new query client
  }
  // Tests: never reuse the singleton, or cache leaks across test cases.
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

export function TRPCReactProvider(
  props: Readonly<{ children: React.ReactNode }>,
) {
  const queryClient = getQueryClient();

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
