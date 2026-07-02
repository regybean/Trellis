import 'server-only';

import type { TRPCQueryOptions } from '@trpc/tanstack-react-query';
import { cache } from 'react';
import { dehydrate, HydrationBoundary } from '@tanstack/react-query';
import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query';

import type { EntitlementsProvider, InjectedAuth } from '@acme/trpc';

import type { AppRouter } from '../api/root';
import { appRouter } from '../api/root';
import { createTRPCContext } from '../api/trpc';
import { createQueryClient } from './query-client';

/**
 * Framework-neutral RSC server caller. The auth + billing seams: the *app*
 * resolves Clerk and chooses an entitlements provider at its boundary, then
 * injects the principal here. This feature depends on no Clerk SDK. A Next.js
 * app wires `await auth()` / `await currentUser()` (from `@clerk/nextjs/server`)
 * and `subscriptionsEntitlements` (from `@acme/subscriptions`) into
 * `createServerTRPC`. See docs/adr/0003-framework-agnostic-auth-seam.md and
 * docs/adr/0006-entitlements-injection-seam.md.
 */
export interface ServerTRPCOptions {
  headers: Headers;
  auth: InjectedAuth;
  user: InjectedUser | null;
  entitlements: EntitlementsProvider;
}

const getQueryClient = cache(createQueryClient);

export function createServerTRPC(opts: ServerTRPCOptions) {
  const createContext = cache(async () => {
    const heads = new Headers(opts.headers);
    heads.set('x-trpc-source', 'rsc');

    return createTRPCContext({
      headers: heads,
      auth: opts.auth,
      user: opts.user,
      entitlements: opts.entitlements,
    });
  });

  return createTRPCOptionsProxy<AppRouter>({
    router: appRouter,
    ctx: createContext,
    queryClient: getQueryClient,
  });
}

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
