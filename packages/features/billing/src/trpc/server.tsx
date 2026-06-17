import 'server-only';

import type { TRPCQueryOptions } from '@trpc/tanstack-react-query';
import { cache } from 'react';
import { headers } from 'next/headers';
import { auth, currentUser } from '@clerk/nextjs/server';
import { dehydrate, HydrationBoundary } from '@tanstack/react-query';
import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query';

import { subscriptionsEntitlements } from '@acme/subscriptions';

import type { AppRouter } from '../api/root';
import { appRouter } from '../api/root';
import { createTRPCContext } from '../api/trpc';
import { createQueryClient } from './query-client';

/**
 * This wraps the `createTRPCContext` helper and provides the required context for the tRPC API when
 * handling a tRPC call from a React Server Component.
 */
const createContext = cache(async () => {
  const heads = new Headers(await headers());
  heads.set('x-trpc-source', 'rsc');

  // RSC adapter for the auth seam: resolve Clerk here (Next.js server) and
  // inject it into the neutral tRPC context.
  return createTRPCContext({
    headers: heads,
    auth: await auth(),
    user: await currentUser(),
    entitlements: subscriptionsEntitlements,
  });
});

const getQueryClient = cache(createQueryClient);

export const trpc = createTRPCOptionsProxy<AppRouter>({
  router: appRouter,
  ctx: createContext,
  queryClient: getQueryClient,
});

export function HydrateClient(props: { children: React.ReactNode }) {
  const queryClient = getQueryClient();
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      {props.children}
    </HydrationBoundary>
  );
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function prefetch<T extends ReturnType<TRPCQueryOptions<any>>>(
  queryOptions: T,
) {
  const queryClient = getQueryClient();
  if (queryOptions.queryKey[1]?.type === 'infinite') {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
    void queryClient.prefetchInfiniteQuery(queryOptions as any);
  } else {
    void queryClient.prefetchQuery(queryOptions);
  }
}
