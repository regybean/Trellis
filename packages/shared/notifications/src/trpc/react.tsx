'use client';

import type { QueryClient } from '@tanstack/react-query';
import type React from 'react';
import { useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import {
  createTRPCClient,
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

// The tRPC React connector for the notifications endpoint. Simpler than a
// feature's: notifications has no persister and no `scopeKey` (the server keys
// the stream by `ctx.auth.userId`), so the provider surface is minimal and the
// mount is byte-identical across all 4 apps.

export const { useTRPC, TRPCProvider } = createTRPCContext<AppRouter>();

let clientQueryClientSingleton: QueryClient | undefined;
const getQueryClient = () => {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (globalThis.window == undefined) {
    return createQueryClient(); // Server: always a fresh client.
  }
  // In tests, avoid the singleton to prevent cross-test cache pollution.
  if (env.NODE_ENV === 'test') {
    return createQueryClient();
  }
  clientQueryClientSingleton ??= createQueryClient();
  return clientQueryClientSingleton;
};

/**
 * Wires the notifications tRPC client + its own QueryClient. The only link that
 * matters is `httpSubscriptionLink` (the `stream` SSE); the `httpLink` half
 * exists so tests stay MSW-friendly and never throw while the SSE link can't
 * connect (ADR 0018, mirroring chat).
 */
export function NotificationsTRPCProvider(
  props: Readonly<{ children: React.ReactNode }>,
) {
  const queryClient = getQueryClient();

  const [trpcClient] = useState(() =>
    createTRPCClient<AppRouter>({
      links:
        env.NODE_ENV === 'test'
          ? [
              splitLink({
                condition: (op) => op.type === 'subscription',
                true: httpSubscriptionLink({
                  transformer: SuperJSON,
                  url: getBaseUrl() + '/api/trpc/notifications',
                }),
                false: httpLink({
                  transformer: SuperJSON,
                  url: getBaseUrl() + '/api/trpc/notifications',
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
                  transformer: SuperJSON,
                  url: getBaseUrl() + '/api/trpc/notifications',
                }),
                false: httpLink({
                  transformer: SuperJSON,
                  url: getBaseUrl() + '/api/trpc/notifications',
                }),
              }),
            ],
    }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
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
